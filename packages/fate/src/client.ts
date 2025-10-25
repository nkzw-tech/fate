import { getFragmentPayloads } from './fragment.ts';
import createRef, {
  assignFragmentTag,
  parseEntityId,
  toEntityId,
} from './ref.ts';
import { selectionFromFragment } from './selection.ts';
import { Store } from './store.ts';
import { Transport } from './transport.ts';
import {
  FragmentKind,
  FragmentResult,
  FragmentsTag,
  isFragmentTag,
  isNodeItem,
  type Entity,
  type EntityConfig,
  type EntityId,
  type FateRecord,
  type Fragment,
  type FragmentData,
  type FragmentRef,
  type ListItem,
  type Query,
  type Selection,
} from './types.ts';

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((value as FateRecord)[k])}`,
  );
  return `{${entries.join(',')}}`;
}

export type FateClientOptions = {
  entities: ReadonlyArray<EntityConfig>;
  transport: Transport;
};

export class FateClient {
  private pending = new Map<string, Promise<void>>();
  private queryDone = new Set<string>();
  private queryInFlight = new Map<string, Promise<void>>();
  private readonly entities: Map<string, EntityConfig>;
  private readonly transport: Transport;
  readonly store = new Store();

  constructor(opts: FateClientOptions) {
    this.transport = opts.transport;
    this.entities = new Map(
      opts.entities.map((entity) => [entity.type, entity]),
    );
  }

  ref<T extends Entity>(
    type: T['__typename'],
    id: string | number,
    fragment: Fragment<T, Selection<T>>,
  ): FragmentRef<T['__typename']> {
    return createRef<T, Selection<T>, Fragment<T, Selection<T>>>(
      type,
      id,
      fragment,
    );
  }

  entityRef(entityId: EntityId, fragment: Fragment<any, any>) {
    const { id, type } = parseEntityId(entityId);
    return createRef(type, id, fragment);
  }

  readFragmentOrThrow<
    T extends Entity,
    S extends Selection<T>,
    F extends Fragment<T, S>,
  >(fragment: F, ref: FragmentRef<T['__typename']>): FragmentData<T, S> {
    const id = ref.id;
    const type = ref.__typename;
    const entityId = toEntityId(type, id);

    const selectedPaths = selectionFromFragment(fragment, ref);
    const missing = this.store.missingForSelection(entityId, selectedPaths);

    if (missing === '*' || (Array.isArray(missing) && missing.length > 0)) {
      const key = this.pendingKey(type, id, missing);
      let promise = this.pending.get(key);
      if (!promise) {
        promise = this.fetchByIdAndNormalize(
          type,
          [id],
          Array.isArray(missing) ? missing : undefined,
        ).finally(() => this.pending.delete(key));
        this.pending.set(key, promise);
      }
      throw promise;
    }

    return this.readFragment<T, S>(fragment, ref, entityId);
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
      { fields?: Iterable<string>; ids: Array<string | number>; type: string }
    >();

    const promises: Array<Promise<void>> = [];
    for (const [name, item] of Object.entries(query)) {
      if (isNodeItem(item)) {
        const fields = item.root
          ? selectionFromFragment(item.root, null)
          : undefined;
        const fieldsSignature = fields
          ? [...fields].slice().sort().join(',')
          : '*';
        const groupKey = `${item.type}#${fieldsSignature}`;
        let group = groups.get(groupKey);
        if (!group) {
          group = { fields, ids: [], type: item.type };
          groups.set(groupKey, group);
        }

        for (const raw of item.ids) {
          const entityId = toEntityId(item.type, raw);
          const missing = this.store.missingForSelection(entityId, fields);
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
    select?: Iterable<string>,
  ) {
    const entries = await this.transport.fetchById(type, ids, select);
    for (const entry of entries) {
      this.normalizeEntity(type, entry as FateRecord, select);
    }
  }

  private async fetchListAndNormalize<T extends Entity, S extends Selection<T>>(
    name: string,
    item: ListItem<Fragment<T, S>>,
  ) {
    if (!this.transport.fetchList) {
      throw new Error(
        `fate: 'transport.fetchList' is not configured but query includes a list for key '${name}'.`,
      );
    }

    const selection = selectionFromFragment(item.root, null);
    const { edges } = await this.transport.fetchList(
      name,
      item.args,
      selection,
    );
    const ids: Array<EntityId> = [];
    for (const edge of edges) {
      const id = this.normalizeEntity(
        item.type,
        edge.node as FateRecord,
        selection,
      );
      ids.push(id);
    }
    this.store.setList(name, ids);
  }

  private normalizeEntity(
    type: string,
    entry: FateRecord,
    select?: Iterable<string>,
  ): EntityId {
    const config = this.entities.get(type);
    if (!config) {
      throw new Error(`fate: Unknown entity type '${type}' in normalization.`);
    }

    const rawId = config.key(entry);
    const id = toEntityId(type, rawId);
    const result: FateRecord = {};

    if (config.fields) {
      for (const [key, relationDescriptor] of Object.entries(config.fields)) {
        const value = entry[key];
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
              ? [...select]
                  .filter((part) => part.startsWith(`${key}.`))
                  .map((part) => part.slice(key.length + 1))
              : undefined;

            this.normalizeEntity(childType, value as FateRecord, childPaths);
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
                ? [...select]
                    .filter((part) => part.startsWith(`${key}.`))
                    .map((part) => part.slice(key.length + 1))
                : undefined;

              this.normalizeEntity(childType, item as FateRecord, childPaths);

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

    for (const [key, value] of Object.entries(entry)) {
      if (!(key in (config.fields ?? {}))) {
        result[key] = value;
      }
    }

    this.store.merge(id, result, select);
    return id;
  }

  private readFragment<T extends Entity, S extends Selection<T>>(
    fragmentComposition: Fragment<T, S>,
    ref: FragmentRef<T['__typename']>,
    entityId: EntityId,
  ): FragmentData<T, S> {
    const record = this.store.read(entityId) || { id: entityId };

    const walk = (
      fragmentPayload: object,
      record: FateRecord,
      target: FragmentResult,
    ) => {
      for (const [key, selectionKind] of Object.entries(fragmentPayload)) {
        if (key === FragmentKind) {
          continue;
        }

        if (isFragmentTag(key)) {
          if (!target[FragmentsTag]) {
            assignFragmentTag(target, new Set());
          }
          const targetObject = target as FateRecord;
          if (!targetObject.id) {
            targetObject.id = target.id;
            targetObject.__typename = 'User';
          }

          target[FragmentsTag]!.add(key);
          continue;
        }

        const selectionType = typeof selectionKind;
        if (selectionType === 'boolean' && selectionKind) {
          target[key] = record[key];
        } else if (selectionKind && selectionType === 'object') {
          if (!(key in target)) {
            target[key] = {};
          }

          const value = record[key];
          if (Array.isArray(value)) {
            if (
              selectionKind.edges &&
              typeof selectionKind.edges === 'object'
            ) {
              const selection = selectionKind.edges as FateRecord;
              const edges = value.map((entityId: string) => {
                const record = this.store.read(entityId);
                const { id, type } = parseEntityId(entityId);
                const node = { __typename: type, id };

                if (record) {
                  walk(selection.node as FateRecord, record, node);
                }

                const edge: FateRecord = {
                  node: record ? node : null,
                };

                if (selection.cursor === true) {
                  edge.cursor = undefined;
                }
                return edge;
              });
              const connection: FateRecord = { edges };
              if ('pageInfo' in selectionKind && selectionKind.pageInfo) {
                connection.pageInfo = undefined;
              }
              target[key] = connection;
            } else {
              target[key] = value.map((entityId: string) => {
                const record = this.store.read(entityId);
                const { id, type } = parseEntityId(entityId);

                if (record) {
                  const node = { __typename: type, id };
                  walk(selectionKind, record, node);
                  return node;
                }

                return null;
              });
            }
          } else if (typeof value === 'string') {
            const { id, type } = parseEntityId(value);
            (target[key] as FateRecord).id = id;
            (target[key] as FateRecord).__typename = type;
            walk(selectionKind, record, target[key] as FragmentResult);
          } else {
            walk(selectionKind, record, target[key] as FragmentResult);
          }
        }
      }
    };

    const result: FragmentResult = {};

    for (const fragmentPayload of getFragmentPayloads(
      fragmentComposition,
      ref,
    )) {
      const fragmentSelect = fragmentPayload.select;
      walk(fragmentSelect, record, result);
    }

    return result as FragmentData<T, S>;
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
