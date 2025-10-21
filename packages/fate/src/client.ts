import { pathsFromSelection } from './selection.ts';
import { Store } from './store.ts';
import { createTokenRegistry, parseEntityId, toEntityId } from './tokens.ts';
import { Transport } from './transport.ts';
import type {
  Entity,
  EntityConfig,
  EntityId,
  Fragment,
  FragmentData,
  FragmentRef,
  ListItem,
  NodeItem,
  Query,
  Selection,
} from './types.ts';

export function isNodeItem(item: ListItem | NodeItem): item is NodeItem {
  return 'ids' in item;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const entries = keys.map(
    (k) =>
      `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
  );
  return `{${entries.join(',')}}`;
}

export type FateClientOptions = {
  entities: ReadonlyArray<EntityConfig>;
  transport: Transport;
};

export class FateClient {
  readonly store = new Store();
  private readonly transport: Transport;
  private readonly entities: Map<string, EntityConfig>;
  private tokens = createTokenRegistry();

  private pending = new Map<string, Promise<void>>();
  private queryInFlight = new Map<string, Promise<void>>();
  private queryDone = new Set<string>();

  constructor(opts: FateClientOptions) {
    this.transport = opts.transport;
    this.entities = new Map(
      opts.entities.map((entity) => [entity.type, entity]),
    );
  }

  ref<TName extends string>(type: TName, rawId: string | number) {
    return this.tokens.refFor(type, rawId);
  }

  toRef(id: EntityId): FragmentRef<string> {
    const { raw, type } = parseEntityId(id);

    return this.ref(type, raw);
  }

  idOf(ref: FragmentRef<string>): EntityId {
    return this.tokens.idOf(ref);
  }

  typeOf(ref: FragmentRef<string>): string {
    return this.tokens.typeOf(ref);
  }

  readFragmentOrThrow<
    T extends Entity,
    S extends Selection<T>,
    F extends Fragment<T, S>,
  >(fragment: F, ref: FragmentRef<string>): FragmentData<T, S> {
    const id = this.idOf(ref);
    const { raw, type } = parseEntityId(id);
    const selectPaths = pathsFromSelection(fragment.select);
    const missing = this.store.missingForSelect(id, selectPaths);

    if (missing === '*' || (Array.isArray(missing) && missing.length > 0)) {
      const key = this.pendingKey(type, raw, missing);
      let promise = this.pending.get(key);
      if (!promise) {
        promise = this.fetchByIdAndNormalize(
          type,
          [raw],
          Array.isArray(missing) ? missing : undefined,
        ).finally(() => this.pending.delete(key));
        this.pending.set(key, promise);
      }
      throw promise;
    }

    return this.store.denormalizeMasked(id, fragment.select) as FragmentData<
      T,
      S
    >;
  }

  ensureQuery(query: Query): Promise<void> | null {
    const signature = this.querySignature(query);
    if (this.queryDone.has(signature)) {
      return null;
    }

    const isPending = this.queryInFlight.get(signature);
    if (isPending) {
      return isPending;
    }

    const promise = this.executeQuery(query)
      .then(() => {
        this.queryDone.add(signature);
      })
      .finally(() => this.queryInFlight.delete(signature));

    this.queryInFlight.set(signature, promise);
    return promise;
  }

  async preload(query: Query): Promise<void> {
    const promise = this.ensureQuery(query);
    if (promise) {
      await promise;
    }
  }

  private async executeQuery(query: Query) {
    type GroupKey = string;
    const groups = new Map<
      GroupKey,
      { fields?: Array<string>; ids: Array<string | number>; type: string }
    >();

    const promises: Array<Promise<void>> = [];
    for (const [name, item] of Object.entries(query)) {
      if (isNodeItem(item)) {
        const fields = item.fields ? [...item.fields] : undefined;
        const fieldsSignature = fields ? fields.slice().sort().join(',') : '*';
        const groupKey = `${item.type}#${fieldsSignature}`;
        let group = groups.get(groupKey);
        if (!group) {
          group = { fields, ids: [], type: item.type };
          groups.set(groupKey, group);
        }

        for (const raw of item.ids) {
          const eid = toEntityId(item.type, raw);
          const missing = this.store.missingForSelect(eid, fields);
          if (
            missing === '*' ||
            (Array.isArray(missing) && missing.length > 0)
          ) {
            group.ids.push(raw);
          }
        }
      } else {
        promises.push(this.fetchListAndNormalize(name, item));
      }
    }

    await Promise.all([
      ...promises,
      ...Array.from(groups.values()).map((group) =>
        group.ids.length
          ? this.fetchByIdAndNormalize(group.type, group.ids, group.fields)
          : Promise.resolve(),
      ),
    ]);
  }

  private async fetchByIdAndNormalize(
    type: string,
    ids: Array<string | number>,
    select?: Array<string>,
  ) {
    const entries = await this.transport.fetchById(type, ids, select);
    for (const entry of entries) {
      this.normalizeEntity(type, entry as Record<string, unknown>, select);
    }
  }

  private async fetchListAndNormalize(name: string, item: ListItem) {
    if (!this.transport.fetchList) {
      throw new Error(
        `fate: 'transport.fetchList' is not configured but query includes a list for proc '${name}'.`,
      );
    }

    const { edges, pageInfo } = await this.transport.fetchList(
      name,
      item.args,
      item.fields as Array<string> | undefined,
    );
    const ids: Array<EntityId> = [];
    for (const edge of edges) {
      const id = this.normalizeEntity(
        item.type,
        edge.node as Record<string, unknown>,
        item.fields as Array<string> | undefined,
      );
      ids.push(id);
    }
    this.store.setList(name, ids);
    this.store.setPageInfo(name, pageInfo);
  }

  private normalizeEntity(
    type: string,
    row: Record<string, unknown>,
    select?: Array<string>,
  ): EntityId {
    const config = this.entities.get(type);
    if (!config) {
      throw new Error(`fate: Unknown entity type '${type}' in normalization.`);
    }

    const rawId = config.key(row);
    const id = toEntityId(type, rawId);
    const result: Record<string, unknown> = {};

    if (config.fields) {
      for (const [key, relationDescriptor] of Object.entries(config.fields)) {
        const value = row[key];
        if (relationDescriptor === 'scalar') {
          result[key] = value;
        } else if (
          relationDescriptor &&
          typeof relationDescriptor === 'object' &&
          'type' in relationDescriptor
        ) {
          if (value && typeof value === 'object') {
            const childType = relationDescriptor.type;
            const childConfig = this.entities.get(childType);
            if (!childConfig) {
              throw new Error(
                `fate: Unknown related type '${childType}' (field ${type}.${key}).`,
              );
            }
            const childId = toEntityId(childType, childConfig.key(value)!);
            result[key] = childId;

            const childPaths = select
              ? select
                  .filter((part) => part.startsWith(`${key}.`))
                  .map((part) => part.slice(key.length + 1))
              : undefined;

            this.store.merge(
              childId,
              this.stripUndeclared(
                childConfig,
                value as Record<string, unknown>,
              ),
              childPaths && childPaths.length ? childPaths : undefined,
            );
          } else {
            result[key] = value;
          }
        } else if (
          relationDescriptor &&
          typeof relationDescriptor === 'object' &&
          'listOf' in relationDescriptor
        ) {
          if (Array.isArray(value)) {
            const childType = relationDescriptor.listOf;
            const childConfig = this.entities.get(childType);
            if (!childConfig) {
              throw new Error(
                `fate: Unknown related type '${childType}' (field ${type}.${key}).`,
              );
            }
            const ids = value.map((item) => {
              const childId = toEntityId(childType, childConfig.key(item)!);
              const childPaths = select
                ? select
                    .filter((part) => part.startsWith(`${key}.`))
                    .map((part) => part.slice(key.length + 1))
                : undefined;

              this.store.merge(
                childId,
                this.stripUndeclared(childConfig, item),
                childPaths && childPaths.length ? childPaths : undefined,
              );

              return childId;
            });
            result[key] = ids;
          } else {
            result[key] = value;
          }
        } else {
          result[key] = value;
        }
      }
    }

    for (const [key, value] of Object.entries(row)) {
      if (!(key in (config.fields ?? {}))) {
        result[key] = value;
      }
    }

    this.store.merge(
      id,
      result,
      select && select.length ? (select as Array<string>) : undefined,
    );
    return id;
  }

  private stripUndeclared(config: EntityConfig, row: Record<string, unknown>) {
    if (!config.fields) {
      return row;
    }

    const result: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      result[key] = row[key];
    }
    return result;
  }

  private pendingKey(
    type: string,
    raw: string | number,
    missingFields: '*' | Array<string>,
  ) {
    return `N|${type}|${raw}|${Array.isArray(missingFields) ? missingFields.slice().sort().join(',') : missingFields}`;
  }

  private querySignature(query: Query): string {
    return `Q|${stableStringify(query)}`;
  }
}

export function createClient(options: FateClientOptions) {
  return new FateClient(options);
}
