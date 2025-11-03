import FragmentDataCache from './cache.ts';
import { getFragmentPayloads } from './fragment.ts';
import createRef, {
  assignFragmentTag,
  parseEntityId,
  toEntityId,
} from './ref.ts';
import { selectionFromFragment } from './selection.ts';
import { Store } from './store.ts';
import { Transport } from './transport.ts';
import { QueryResult } from './types.js';
import {
  FateThenable,
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
  type MutationDefinition,
  type MutationIdentifier,
  type MutationMapFromDefinitions,
  type Query,
  type Selection,
  type Snapshot,
} from './types.ts';

type MutationIdentifierFor<
  K extends string,
  Def extends MutationDefinition<any, any, any>,
> =
  Def extends MutationDefinition<infer T, infer I, infer R>
    ? MutationIdentifier<T, I, R> & Readonly<{ key: K }>
    : never;

type MutationTransport<
  Mutations extends Record<string, MutationDefinition<any, any, any>>,
> = MutationMapFromDefinitions<Mutations>;

type EmptyMutations = Record<never, MutationDefinition<any, any, any>>;

export type FateClientOptions<
  Mutations extends Record<
    string,
    MutationDefinition<any, any, any>
  > = EmptyMutations,
> = {
  entities: ReadonlyArray<EntityConfig>;
  mutations?: Mutations;
  transport: Transport<MutationTransport<Mutations>>;
};

export class FateClient<
  Mutations extends Record<
    string,
    MutationDefinition<any, any, any>
  > = EmptyMutations,
> {
  private readonly pending = new Map<
    string,
    PromiseLike<FragmentData<any, any>>
  >();
  private readonly requests = new Map<Query, Promise<QueryResult<Query>>>();
  private readonly entities: Map<string, EntityConfig>;
  private readonly transport: Transport<MutationTransport<Mutations>>;
  private readonly fragmentDataCache = new FragmentDataCache();
  private readonly mutationConfigs = new Map<string, { entity: string }>();
  private readonly parentLists = new Map<
    string,
    Array<{ field: string; parentType: string; via?: string }>
  >();
  readonly store = new Store();

  readonly mutations: {
    [K in keyof Mutations]: MutationIdentifierFor<K & string, Mutations[K]>;
  };

  constructor(options: FateClientOptions<Mutations>) {
    this.transport = options.transport;
    this.entities = new Map(
      options.entities.map((entity) => [entity.type, entity]),
    );
    this.mutations = Object.create(null);

    this.initializeParentLists();

    if (options.mutations) {
      for (const [key, definition] of Object.entries(options.mutations)) {
        this.mutationConfigs.set(key, {
          entity: definition.entity,
        });

        (this.mutations as Record<string, unknown>)[key] = {
          ...definition,
          key,
        };
      }
    }
  }

  private initializeParentLists() {
    for (const config of this.entities.values()) {
      if (!config.fields) {
        continue;
      }

      for (const [field, descriptor] of Object.entries(config.fields)) {
        if (
          descriptor &&
          typeof descriptor === 'object' &&
          'listOf' in descriptor
        ) {
          const childType = descriptor.listOf;
          const childConfig = this.entities.get(childType);
          if (!childConfig) {
            throw new Error(
              `fate: Unknown related type '${childType}' (field '${config.type}.${field}').`,
            );
          }

          if (!childConfig.fields) {
            continue;
          }

          let via: string | undefined;
          for (const [childField, childDescriptor] of Object.entries(
            childConfig.fields,
          )) {
            if (
              childDescriptor &&
              typeof childDescriptor === 'object' &&
              'type' in childDescriptor &&
              childDescriptor.type === config.type
            ) {
              via = childField;
              break;
            }
          }

          if (!via) {
            continue;
          }

          let list = this.parentLists.get(childType);
          if (!list) {
            list = [];
            this.parentLists.set(childType, list);
          }

          list.push({ field, parentType: config.type, via });
        }
      }
    }
  }

  getEntityConfig(type: string): EntityConfig {
    const config = this.entities.get(type);
    if (!config) {
      throw new Error(`fate: Unknown entity type '${type}'.`);
    }
    return config;
  }

  async executeMutation(key: string, input: unknown): Promise<unknown> {
    if (!this.transport.mutate) {
      throw new Error(`fate: transport does not support mutations.`);
    }

    return await this.transport.mutate(key as any, input as any);
  }

  write(
    type: string,
    data: FateRecord,
    select?: Set<string>,
    snapshots?: Map<EntityId, Snapshot>,
  ) {
    return this.normalizeEntity(type, data, select, snapshots);
  }

  restore(id: EntityId, snapshot: Snapshot) {
    this.fragmentDataCache.delete(id);
    this.store.restore(id, snapshot);
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

  readFragment<
    T extends Entity,
    S extends Selection<T>,
    F extends Fragment<T, S>,
  >(
    fragment: F,
    ref: FragmentRef<T['__typename']>,
  ): FateThenable<FragmentData<T, S>> {
    const id = ref.id;
    const type = ref.__typename;
    if (id == null) {
      throw new Error(
        `fate: Invalid fragment reference. Expected 'id' to be provided as part of the reference, received '${JSON.stringify(ref, null, 2)}'.`,
      );
    }

    if (type == null) {
      throw new Error(
        `fate: Invalid fragment reference. Expected '__typename' to be provided as part of the reference, received '${JSON.stringify(ref, null, 2)}'.`,
      );
    }

    const entityId = toEntityId(type, id);
    const cached = this.fragmentDataCache.get(entityId, fragment, ref);
    if (cached) {
      return cached as FateThenable<FragmentData<T, S>>;
    }

    const selectedPaths = selectionFromFragment(fragment, ref);
    const missing = this.store.missingForSelection(entityId, selectedPaths);

    if (missing === '*' || (Array.isArray(missing) && missing.length > 0)) {
      const key = this.pendingKey(type, id, missing);
      const pendingPromise = this.pending.get(key) || null;
      if (pendingPromise) {
        return pendingPromise as FateThenable<FragmentData<T, S>>;
      }

      const promise = this.fetchByIdAndNormalize(
        type,
        [id],
        Array.isArray(missing) ? missing : undefined,
      )
        .finally(() => this.pending.delete(key))
        .then(() => this.readFragment<T, S, F>(fragment, ref));

      this.pending.set(key, promise);

      return promise as unknown as FateThenable<FragmentData<T, S>>;
    }

    const resolvedFragment = this.readFragmentSelection<T, S>(
      fragment,
      ref,
      entityId,
    );

    const thenable = {
      status: 'fulfilled' as const,
      then: <TResult1 = FragmentData<T, S>, TResult2 = never>(
        onfulfilled?: (
          value: FragmentData<T, S>,
        ) => TResult1 | PromiseLike<TResult1>,
        onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
      ): PromiseLike<TResult1 | TResult2> =>
        Promise.resolve(resolvedFragment).then(onfulfilled, onrejected),
      value: resolvedFragment,
    } as const;

    this.fragmentDataCache.set(entityId, fragment, ref, thenable);
    return thenable;
  }

  request<Q extends Query>(query: Q): Promise<QueryResult<Q>> {
    const existingRequest = this.requests.get(query);
    if (existingRequest) {
      return existingRequest as Promise<QueryResult<Q>>;
    }

    const promise = this.executeQuery(query).then(() =>
      this.getRequestResult(query),
    );

    this.requests.set(query, promise);

    return promise;
  }

  private async executeQuery(query: Query) {
    type GroupKey = string;
    const groups = new Map<
      GroupKey,
      { fields?: Set<string>; ids: Array<string | number>; type: string }
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

  getRequestResult<Q extends Query>(query: Q): QueryResult<Q> {
    const result: FateRecord = {};
    for (const [name, item] of Object.entries(query)) {
      result[name] = isNodeItem(item)
        ? item.ids.map((id) => this.ref(item.type, id, item.root))
        : (this.store.getList(name) ?? []).map((id: string) =>
            this.entityRef(id, item.root),
          );
    }
    return result as QueryResult<Q>;
  }

  private async fetchByIdAndNormalize(
    type: string,
    ids: Array<string | number>,
    select?: Set<string>,
  ) {
    const records = await this.transport.fetchById(type, ids, select);
    for (const record of records) {
      this.normalizeEntity(type, record as FateRecord, select);
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
    record: FateRecord,
    select?: Set<string>,
    snapshots?: Map<EntityId, Snapshot>,
  ): EntityId {
    const config = this.entities.get(type);
    if (!config) {
      throw new Error(
        `fate: Found unknown entity type '${type}' in normalization.`,
      );
    }

    const id = config.key(record);
    const entityId = toEntityId(type, id);
    const result: FateRecord = {};

    if (config.fields) {
      for (const [key, relationDescriptor] of Object.entries(config.fields)) {
        const value = record[key];
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
                `fate: Unknown related type '${childType}' (field '${type}.${key}').`,
              );
            }
            const childId = toEntityId(childType, childConfig.key(value)!);
            result[key] = childId;

            const childPaths = select
              ? new Set(
                  [...select]
                    .filter((part) => part.startsWith(`${key}.`))
                    .map((part) => part.slice(key.length + 1)),
                )
              : undefined;

            this.normalizeEntity(
              childType,
              value as FateRecord,
              childPaths,
              snapshots,
            );
          } else if (value !== undefined) {
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
                `fate: Unknown related type '${childType}' (field '${type}.${key}').`,
              );
            }
            const ids = value.map((item: FateRecord) => {
              const childId = toEntityId(childType, childConfig.key(item)!);
              const childPaths = select
                ? new Set(
                    [...select]
                      .filter((part) => part.startsWith(`${key}.`))
                      .map((part) => part.slice(key.length + 1)),
                  )
                : undefined;

              this.normalizeEntity(childType, item, childPaths, snapshots);

              return childId;
            });
            result[key] = ids;
          } else if (value !== undefined) {
            result[key] = value;
          }
        } else {
          result[key] = value;
        }
      }
    }

    for (const [key, value] of Object.entries(record)) {
      if (!(key in (config.fields ?? {}))) {
        result[key] = value;
      }
    }

    if (snapshots && !snapshots.has(entityId)) {
      snapshots.set(entityId, this.store.snapshot(entityId));
    }

    this.fragmentDataCache.delete(entityId);
    this.store.merge(entityId, result, select);
    this.linkParentLists(type, entityId, result, snapshots);
    return entityId;
  }

  private linkParentLists(
    type: string,
    entityId: EntityId,
    record: FateRecord,
    snapshots?: Map<EntityId, Snapshot>,
  ) {
    const parents = this.parentLists.get(type);
    if (!parents) {
      return;
    }

    for (const parent of parents) {
      if (!parent.via) {
        continue;
      }

      const parentRef = record[parent.via];
      if (typeof parentRef !== 'string') {
        continue;
      }

      const parentId = parentRef;
      const existing = this.store.read(parentId);
      if (!existing) {
        continue;
      }

      const current = Array.isArray(existing[parent.field])
        ? (existing[parent.field] as Array<EntityId>)
        : [];

      if (current.includes(entityId)) {
        continue;
      }

      if (snapshots && !snapshots.has(parentId)) {
        snapshots.set(parentId, this.store.snapshot(parentId));
      }

      this.fragmentDataCache.delete(parentId);
      this.store.merge(parentId, { [parent.field]: [...current, entityId] }, [
        parent.field,
      ]);
    }
  }

  private readFragmentSelection<T extends Entity, S extends Selection<T>>(
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
}

export function createClient<
  Mutations extends Record<
    string,
    MutationDefinition<any, any, any>
  > = EmptyMutations,
>(options: FateClientOptions<Mutations>) {
  return new FateClient<Mutations>(options);
}
