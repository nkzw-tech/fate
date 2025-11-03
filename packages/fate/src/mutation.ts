import type { FateClient } from './client.js';
import { selectionFromView } from './selection.ts';
import type {
  Entity,
  FateRecord,
  MutationDefinition,
  MutationEntity,
  MutationIdentifier,
  MutationInput,
  MutationResult,
  Selection,
  Snapshot,
  TypeConfig,
  View,
} from './types.ts';
import { MutationKind } from './types.ts';

export function mutation<T extends Entity, I, R>(
  entity: T['__typename'],
): MutationDefinition<T, I, R> {
  return {
    entity,
    [MutationKind]: true,
  };
}

type MutationOptions<Identifier extends MutationIdentifier<any, any, any>> = {
  input: MutationInput<Identifier>;
  optimisticUpdate?: Partial<MutationResult<Identifier>>;
  view?:
    | View<MutationEntity<Identifier>, Selection<MutationEntity<Identifier>>>
    | 'deleteRecord';
};

export type MutationFunction<I extends MutationIdentifier<any, any, any>> = (
  options: MutationOptions<I>,
) => Promise<MutationResult<I>>;

const collectImplicitSelectedPaths = (value: FateRecord): Set<string> => {
  const paths = new Set<string>();

  const walk = (current: unknown, prefix: string | null) => {
    if (!current || typeof current !== 'object') {
      if (prefix) {
        paths.add(prefix);
      }
      return;
    }

    if (Array.isArray(current)) {
      if (prefix) {
        paths.add(prefix);
      }
      return;
    }

    for (const [key, child] of Object.entries(current as FateRecord)) {
      const next = prefix ? `${prefix}.${key}` : key;
      paths.add(next);
      walk(child, next);
    }
  };

  walk(value, null);
  return paths;
};

const maybeGetId = (getId: TypeConfig['getId'], input: FateRecord) => {
  try {
    return getId(input);
  } catch {
    return null;
  }
};

export function wrapMutation<
  I extends MutationIdentifier<any, any, any>,
  M extends Record<string, MutationDefinition<any, any, any>>,
>(client: FateClient<M>, identifier: I): MutationFunction<I> {
  const config = client.getTypeConfig(identifier.entity);

  return async ({ input, optimisticUpdate, view }: MutationOptions<I>) => {
    const id = maybeGetId(config.getId, input);
    const isDelete = view === 'deleteRecord';
    const viewSelection =
      view && !isDelete ? selectionFromView(view, null) : undefined;

    const optimisticRecord: FateRecord | undefined = optimisticUpdate
      ? ((id != null
          ? { id, ...optimisticUpdate }
          : optimisticUpdate) as FateRecord)
      : undefined;
    const optimisticRecordId =
      optimisticRecord !== undefined
        ? maybeGetId(config.getId, optimisticRecord)
        : null;

    const snapshots = new Map<string, Snapshot>();
    const listSnapshots = isDelete
      ? new Map<string, Array<string>>()
      : undefined;
    const optimisticSelection = optimisticRecord
      ? collectImplicitSelectedPaths(optimisticRecord)
      : undefined;

    const selection =
      viewSelection || optimisticSelection
        ? new Set<string>([
            ...(viewSelection ? [...viewSelection] : []),
            ...(optimisticSelection ? [...optimisticSelection] : []),
          ])
        : undefined;

    if (isDelete) {
      if (id == null) {
        throw new Error(
          `fate: Mutation '${identifier.key}' requires an 'id' to delete.`,
        );
      }

      client.deleteRecord(identifier.entity, id, snapshots, listSnapshots);
    } else if (optimisticRecord && (id != null || optimisticRecordId != null)) {
      client.write(
        identifier.entity,
        optimisticRecord,
        optimisticSelection,
        snapshots,
      );
    }

    try {
      const result = (await client.executeMutation(
        identifier.key,
        input,
        selection,
      )) as MutationResult<I>;

      if (!isDelete && result && typeof result === 'object') {
        const select = collectImplicitSelectedPaths(result);
        client.write(
          identifier.entity,
          result,
          select.size > 0 ? select : undefined,
        );
      }

      return result;
    } catch (error) {
      if (snapshots.size > 0) {
        for (const [id, snapshot] of snapshots) {
          client.restore(id, snapshot);
        }
      }

      if (listSnapshots && listSnapshots.size > 0) {
        for (const [name, ids] of listSnapshots) {
          client.restoreList(name, ids);
        }
      }

      throw error instanceof Error
        ? error
        : new Error(`fate: Mutation '${identifier.key}' failed.`);
    }
  };
}
