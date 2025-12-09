import { TRPCError } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import type { FateClient } from './client.js';
import type {
  AnyRecord,
  Entity,
  MutationDefinition,
  MutationEntity,
  MutationIdentifier,
  MutationInput,
  MutationResult,
  OptimisticUpdate,
  Selection,
  Snapshot,
  TypeConfig,
  View,
} from './types.ts';
import { toEntityId } from './ref.ts';
import { getSelectionPlan } from './selection.ts';
import { List } from './store.ts';
import { MutationKind } from './types.ts';

/**
 * Defines a mutation for a given entity type, preserving the input and output
 * types for transports.
 */
export function mutation<T extends Entity, I, R>(
  entity: T['__typename'],
): MutationDefinition<T, I, R> {
  return Object.freeze({
    entity,
    [MutationKind]: true,
  }) as MutationDefinition<T, I, R>;
}

/** Where (or if) to insert the resulting record into relevant lists. */
export type InsertPosition = 'after' | 'before' | 'none';
/**
 * Options accepted by a mutation invocation, including optimistic updates and
 * optional selection for the returned payload.
 */
export type MutationOptions<Identifier extends MutationIdentifier<any, any, any>> = {
  /** Optional arguments to pass to the mutation resolver. */
  args?: Record<string, unknown>;
  /** If true, deletes the record with the ID specified in the input. */
  delete?: boolean;
  /** Input data for the mutation. */
  input: Omit<MutationInput<Identifier>, 'select'>;
  insert?: InsertPosition;
  /** Optional optimistic update to apply immediately. */
  optimistic?: OptimisticUpdate<MutationResult<Identifier>>;
  /** Optional view specifying which fields to select from the server. */
  view?: View<MutationEntity<Identifier>, Selection<MutationEntity<Identifier>>>;
};

/**
 * Callable mutation entry point returned on the client that resolves to either
 * a successful result or an error.
 */
export type MutationFunction<I extends MutationIdentifier<any, any, any>> = (
  options: MutationOptions<I>,
) => Promise<{ error: undefined; result: MutationResult<I> } | { error: Error; result: undefined }>;

/**
 * React action-compatible wrapper that can be passed directly to form actions
 * or transitions.
 */
export type MutationAction<I extends MutationIdentifier<any, any, any>> = (
  previousState: unknown,
  /**
   * Mutation options or 'reset' to reset the action state.
   */
  options: MutationOptions<I> | 'reset',
) => Promise<{ error: undefined; result: MutationResult<I> } | { error: Error; result: undefined }>;

type MutationIdentifierFor<K extends string, Def extends MutationDefinition<any, any, any>> =
  Def extends MutationDefinition<infer T, infer I, infer R>
    ? MutationIdentifier<T, I, R> & Readonly<{ key: K }>
    : never;

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never;

type NestedValue<Path extends string, Value> = Path extends `${infer Head}.${infer Tail}`
  ? { [K in Head]: NestedValue<Tail, Value> }
  : { [K in Path]: Value };

/**
 * Base type for client mutations.
 */

export type FateMutations = Record<string, MutationDefinition<any, any, any>>;

type MutationTreeFromRecord<
  Mutations extends FateMutations,
  ValueMap extends Record<string, unknown>,
> = [keyof Mutations] extends [never]
  ? object
  : UnionToIntersection<
      {
        [K in keyof Mutations & string]: NestedValue<K, ValueMap[K]>;
      }[keyof Mutations & string]
    >;

export type MutationFunctionsFor<Mutations extends FateMutations> = MutationTreeFromRecord<
  Mutations,
  {
    [K in keyof Mutations & string]: MutationFunction<MutationIdentifierFor<K, Mutations[K]>>;
  }
>;

export type MutationActionsFor<Mutations extends FateMutations> = MutationTreeFromRecord<
  Mutations,
  {
    [K in keyof Mutations & string]: MutationAction<MutationIdentifierFor<K, Mutations[K]>>;
  }
>;

const collectImplicitSelectedPaths = (value: AnyRecord): Set<string> => {
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

      for (const child of current) {
        walk(child, prefix);
      }
      return;
    }

    for (const [key, child] of Object.entries(current as AnyRecord)) {
      const next = prefix ? `${prefix}.${key}` : key;
      paths.add(next);
      walk(child, next);
    }
  };

  walk(value, null);
  return paths;
};

const maybeGetId = (getId: TypeConfig['getId'], input: AnyRecord) => {
  try {
    return getId(input);
  } catch {
    return null;
  }
};

const emptySet: ReadonlySet<string> = new Set();

/**
 * Binds a mutation definition to a `FateClient`, wiring up optimistic updates,
 * cache writes, and error handling.
 */
export function wrapMutation<
  I extends MutationIdentifier<any, any, any>,
  M extends Record<string, MutationDefinition<any, any, any>>,
>(client: FateClient<any, M>, identifier: I): MutationFunction<I> {
  const config = client.getTypeConfig(identifier.entity);

  return async ({
    args,
    delete: deleteRecord,
    input,
    insert = 'after',
    optimistic,
    view,
  }: MutationOptions<I>) => {
    const id = maybeGetId(config.getId, input);
    const plan = view ? getSelectionPlan(view, null) : undefined;
    const viewSelection = plan?.paths;

    const optimisticRecord: AnyRecord | undefined = optimistic
      ? ((id != null ? { id, ...optimistic } : optimistic) as AnyRecord)
      : undefined;
    const optimisticRecordId =
      optimisticRecord !== undefined ? maybeGetId(config.getId, optimisticRecord) : null;

    const optimisticEntityId =
      id != null
        ? toEntityId(identifier.entity, id)
        : optimisticRecordId != null
          ? toEntityId(identifier.entity, optimisticRecordId)
          : null;

    const snapshots = new Map<string, Snapshot>();
    const listSnapshots = deleteRecord ? new Map<string, List>() : undefined;
    const optimisticSelection = optimisticRecord
      ? collectImplicitSelectedPaths(optimisticRecord)
      : undefined;

    const selection =
      viewSelection || optimisticSelection
        ? new Set<string>([
            ...(viewSelection ? [...viewSelection] : []),
            ...(optimisticSelection ? [...optimisticSelection] : []),
          ])
        : new Set<string>();

    const optimisticToken = optimisticEntityId
      ? client.registerOptimisticUpdate(optimisticEntityId, optimisticSelection ?? emptySet)
      : null;

    if (optimisticRecord && optimisticEntityId) {
      client.write(
        identifier.entity,
        optimisticRecord,
        optimisticSelection ?? emptySet,
        snapshots,
        plan,
        null,
        null,
        insert,
      );
    }

    if (deleteRecord) {
      if (id == null) {
        throw new Error(`fate: Mutation '${identifier.key}' requires an 'id' to delete.`);
      }

      client.deleteRecord(identifier.entity, id, snapshots, listSnapshots);
    }

    const performMutation = async () => {
      try {
        const result = (await client.executeMutation(identifier.key, input, selection, {
          args,
          plan,
        })) as MutationResult<I>;

        const shouldWriteResult =
          result && typeof result === 'object' && (!deleteRecord || Boolean(view));

        if (shouldWriteResult) {
          const select = collectImplicitSelectedPaths(result);
          const pendingMask = optimisticEntityId
            ? client.getPendingOptimisticMask(optimisticEntityId, { excludeToken: optimisticToken })
            : null;
          const filteredSelection = optimisticEntityId
            ? client.filterSelectionForPendingOptimistics(optimisticEntityId, select, {
                excludeToken: optimisticToken,
              })
            : select;

          client.write(
            identifier.entity,
            result,
            filteredSelection,
            undefined,
            plan,
            null,
            pendingMask,
            insert,
          );

          if (deleteRecord && id != null) {
            client.deleteRecord(identifier.entity, id);
          }

          const resultId = maybeGetId(config.getId, result as AnyRecord);
          if (optimisticEntityId && resultId != null) {
            client.resolveOptimisticEntity(
              optimisticEntityId,
              toEntityId(identifier.entity, resultId),
            );
          }
          if (optimisticRecordId != null && resultId != null && optimisticRecordId !== resultId) {
            client.deleteRecord(identifier.entity, optimisticRecordId);
          }
        }

        return { error: undefined, result };
      } catch (error) {
        client.clearOptimisticUpdate(optimisticToken);
        if (snapshots.size > 0) {
          for (const [id, snapshot] of snapshots) {
            client.restore(id, snapshot);
          }
        }

        if (listSnapshots && listSnapshots.size > 0) {
          for (const [name, list] of listSnapshots) {
            client.restoreList(name, list);
          }
        }

        if (error instanceof Error) {
          const { data } = error as { data?: TRPCError };
          const errorCategory = data
            ? categorizeTRPCError(getHTTPStatusCodeFromError(data))
            : 'boundary';

          if (errorCategory === 'boundary') {
            throw error;
          }

          return { error, result: undefined };
        } else {
          throw new Error(`fate: Mutation '${identifier.key}' failed.`);
        }
      } finally {
        client.clearOptimisticUpdate(optimisticToken);
      }
    };

    const mutationPromise = performMutation();

    if (optimisticEntityId) {
      client.registerPendingOptimisticMutation(optimisticEntityId, mutationPromise);
    }

    return mutationPromise;
  };
}

export type ErrorHandlingScope = 'callSite' | 'boundary';

// See https://trpc.io/docs/server/error-handling#error-codes
export function categorizeTRPCError(statusCode: number): ErrorHandlingScope {
  switch (statusCode) {
    case 400: // BAD_REQUEST
    case 402: // PAYMENT_REQUIRED
    case 404: // NOT_FOUND (resource-level)
    case 408: // TIMEOUT
    case 409: // CONFLICT
    case 412: // PRECONDITION_FAILED
    case 413: // PAYLOAD_TOO_LARGE
    case 415: // UNSUPPORTED_MEDIA_TYPE
    case 422: // UNPROCESSABLE_CONTENT
    case 429: // TOO_MANY_REQUESTS
    case 499: // CLIENT_CLOSED_REQUEST
      return 'callSite';

    case 401: // UNAUTHORIZED
    case 403: // FORBIDDEN
    case 405: // METHOD_NOT_SUPPORTED
    case 428: // PRECONDITION_REQUIRED
    case 500: // INTERNAL_SERVER_ERROR
    case 501: // NOT_IMPLEMENTED
    case 502: // BAD_GATEWAY
    case 503: // SERVICE_UNAVAILABLE
    case 504: // GATEWAY_TIMEOUT
    default:
      return 'boundary';
  }
}
