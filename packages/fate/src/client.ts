import ViewDataCache from './cache.ts';
import { MutationFunction, wrapMutation } from './mutation.ts';
import { createNodeRef, getNodeRefId, isNodeRef } from './node-ref.ts';
import createRef, { assignViewTag, parseEntityId, toEntityId } from './ref.ts';
import { selectionFromView } from './selection.ts';
import { Store } from './store.ts';
import { Transport } from './transport.ts';
import { RequestResult } from './types.js';
import {
  FateThenable,
  isNodeItem,
  isViewTag,
  ViewKind,
  ViewResult,
  ViewsTag,
  type Entity,
  type EntityId,
  type FateRecord,
  type ListItem,
  type MutationDefinition,
  type MutationIdentifier,
  type MutationMapFromDefinitions,
  type Request,
  type Selection,
  type Snapshot,
  type TypeConfig,
  type View,
  type ViewData,
  type ViewRef,
} from './types.ts';
import { getViewPayloads } from './view.ts';

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

type FateClientOptions<
  Mutations extends Record<
    string,
    MutationDefinition<any, any, any>
  > = EmptyMutations,
> = {
  mutations?: Mutations;
  transport: Transport<MutationTransport<Mutations>>;
  types: ReadonlyArray<
    Omit<TypeConfig, 'getId'> & Partial<{ getId: TypeConfig['getId'] }>
  >;
};

const getId: TypeConfig['getId'] = (record: unknown) => {
  if (!record || typeof record !== 'object' || !('id' in record)) {
    throw new Error(`fate: Missing 'id' on entity record.`);
  }

  const value = (record as { id: string | number }).id;
  const valueType = typeof value;
  if (valueType !== 'string' && valueType !== 'number') {
    throw new Error(
      `fate: Entity id must be a string or number, received '${valueType}'.`,
    );
  }
  return value;
};

export class FateClient<
  Mutations extends Record<
    string,
    MutationDefinition<any, any, any>
  > = EmptyMutations,
> {
  private readonly pending = new Map<string, PromiseLike<ViewData<any, any>>>();
  private readonly requests = new Map<
    Request,
    Promise<RequestResult<Request>>
  >();
  private readonly types: Map<string, TypeConfig>;
  private readonly transport: Transport<MutationTransport<Mutations>>;
  private readonly viewDataCache = new ViewDataCache();
  private readonly parentLists = new Map<
    string,
    Array<{ field: string; parentType: string; via?: string }>
  >();
  readonly store = new Store();

  readonly mutations: {
    [K in keyof Mutations]: MutationFunction<
      MutationIdentifierFor<K & string, Mutations[K]>
    >;
  };

  constructor(options: FateClientOptions<Mutations>) {
    this.transport = options.transport;
    this.types = new Map(
      options.types.map((entity) => [entity.type, { getId, ...entity }]),
    );
    this.mutations = Object.create(null);

    if (options.mutations) {
      for (const [key, definition] of Object.entries(options.mutations)) {
        (this.mutations as Record<string, unknown>)[key] = wrapMutation(this, {
          ...definition,
          key,
        });
      }
    }

    this.initializeParentLists();
  }

  private initializeParentLists() {
    for (const config of this.types.values()) {
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
          const childConfig = this.types.get(childType);
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

  getTypeConfig(type: string): TypeConfig {
    const config = this.types.get(type);
    if (!config) {
      throw new Error(`fate: Unknown entity type '${type}'.`);
    }
    return config;
  }

  async executeMutation(
    key: string,
    input: unknown,
    select?: Set<string>,
  ): Promise<unknown> {
    if (!this.transport.mutate) {
      throw new Error(`fate: transport does not support mutations.`);
    }

    return await this.transport.mutate(key as any, input as any, select);
  }

  write(
    type: string,
    data: FateRecord,
    select?: Set<string>,
    snapshots?: Map<EntityId, Snapshot>,
  ) {
    return this.normalizeEntity(type, data, select, snapshots);
  }

  deleteRecord(
    type: string,
    id: string | number,
    snapshots?: Map<EntityId, Snapshot>,
    listSnapshots?: Map<string, Array<EntityId>>,
  ) {
    const entityId = toEntityId(type, id);

    if (snapshots && !snapshots.has(entityId)) {
      snapshots.set(entityId, this.store.snapshot(entityId));
    }

    this.viewDataCache.delete(entityId);
    this.store.deleteRecord(entityId);
    this.store.removeReferencesTo(
      entityId,
      this.viewDataCache,
      snapshots,
      listSnapshots,
    );
  }

  restore(id: EntityId, snapshot: Snapshot) {
    this.viewDataCache.delete(id);
    this.store.restore(id, snapshot);
  }

  restoreList(name: string, ids?: Array<EntityId>) {
    this.store.restoreList(name, ids);
  }

  ref<T extends Entity>(
    type: T['__typename'],
    id: string | number,
    view: View<T, Selection<T>>,
  ): ViewRef<T['__typename']> {
    return createRef<T, Selection<T>, View<T, Selection<T>>>(type, id, view);
  }

  rootListRef(entityId: EntityId, rootView: View<any, any>) {
    const { id, type } = parseEntityId(entityId);
    return createRef(type, id, rootView, { root: true });
  }

  readView<T extends Entity, S extends Selection<T>, V extends View<T, S>>(
    view: V,
    ref: ViewRef<T['__typename']>,
  ): FateThenable<ViewData<T, S>> {
    const id = ref.id;
    const type = ref.__typename;
    if (id == null) {
      throw new Error(
        `fate: Invalid view reference. Expected 'id' to be provided as part of the reference, received '${JSON.stringify(ref, null, 2)}'.`,
      );
    }

    if (type == null) {
      throw new Error(
        `fate: Invalid view reference. Expected '__typename' to be provided as part of the reference, received '${JSON.stringify(ref, null, 2)}'.`,
      );
    }

    const entityId = toEntityId(type, id);
    const cached = this.viewDataCache.get(entityId, view, ref);
    if (cached) {
      return cached as FateThenable<ViewData<T, S>>;
    }

    const selectedPaths = selectionFromView(view, ref);
    const missing = this.store.missingForSelection(entityId, selectedPaths);

    if (missing === '*' || missing.size > 0) {
      const key = this.pendingKey(type, id, missing);
      const pendingPromise = this.pending.get(key) || null;
      if (pendingPromise) {
        return pendingPromise as FateThenable<ViewData<T, S>>;
      }

      const promise = this.fetchByIdAndNormalize(
        type,
        [id],
        missing === '*' ? undefined : missing,
      )
        .finally(() => this.pending.delete(key))
        .then(() => this.readView<T, S, V>(view, ref));

      this.pending.set(key, promise);

      return promise as unknown as FateThenable<ViewData<T, S>>;
    }

    const resolvedView = this.readViewSelection<T, S>(view, ref, entityId);

    const thenable = {
      status: 'fulfilled' as const,
      then: <TResult1 = ViewData<T, S>, TResult2 = never>(
        onfulfilled?: (
          value: ViewData<T, S>,
        ) => TResult1 | PromiseLike<TResult1>,
        onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
      ): PromiseLike<TResult1 | TResult2> =>
        Promise.resolve(resolvedView).then(onfulfilled, onrejected),
      value: resolvedView,
    } as const;

    this.viewDataCache.set(entityId, view, ref, thenable);
    return thenable;
  }

  request<R extends Request>(request: R): Promise<RequestResult<R>> {
    const existingRequest = this.requests.get(request);
    if (existingRequest) {
      return existingRequest as Promise<RequestResult<R>>;
    }

    const promise = this.executeRequest(request).then(() =>
      this.getRequestResult(request),
    );

    this.requests.set(request, promise);

    return promise;
  }

  private async executeRequest(request: Request) {
    type GroupKey = string;
    const groups = new Map<
      GroupKey,
      { fields?: Set<string>; ids: Array<string | number>; type: string }
    >();

    const promises: Array<Promise<void>> = [];
    for (const [name, item] of Object.entries(request)) {
      if (isNodeItem(item)) {
        const fields = item.root
          ? selectionFromView(item.root, null)
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
          if (missing === '*' || missing.size > 0) {
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

  getRequestResult<R extends Request>(request: R): RequestResult<R> {
    const result: FateRecord = {};
    for (const [name, item] of Object.entries(request)) {
      result[name] = isNodeItem(item)
        ? item.ids.map((id) => this.ref(item.type, id, item.root))
        : (this.store.getList(name) ?? []).map((id: string) =>
            this.rootListRef(id, item.root),
          );
    }
    return result as RequestResult<R>;
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
    item: ListItem<View<T, S>>,
  ) {
    if (!this.transport.fetchList) {
      throw new Error(
        `fate: 'transport.fetchList' is not configured but request includes a list for key '${name}'.`,
      );
    }

    const selection = selectionFromView(item.root, null);
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
    const config = this.types.get(type);
    if (!config) {
      throw new Error(
        `fate: Found unknown entity type '${type}' in normalization.`,
      );
    }

    const id = config.getId(record);
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
          if (value && typeof value === 'object' && !isNodeRef(value)) {
            const childType = relationDescriptor.type;
            const childConfig = this.types.get(childType);
            if (!childConfig) {
              throw new Error(
                `fate: Unknown related type '${childType}' (field '${type}.${key}').`,
              );
            }
            const childId = toEntityId(childType, childConfig.getId(value));
            result[key] = createNodeRef(childId);

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
            const childConfig = this.types.get(childType);
            if (!childConfig) {
              throw new Error(
                `fate: Unknown related type '${childType}' (field '${type}.${key}').`,
              );
            }
            const refs = value.map((item) => {
              if (isNodeRef(item)) {
                return item;
              }

              if (item && typeof item === 'object') {
                const childId = toEntityId(
                  childType,
                  childConfig.getId(item as FateRecord),
                );
                const childPaths = select
                  ? new Set(
                      [...select]
                        .filter((part) => part.startsWith(`${key}.`))
                        .map((part) => part.slice(key.length + 1)),
                    )
                  : undefined;

                this.normalizeEntity(
                  childType,
                  item as FateRecord,
                  childPaths,
                  snapshots,
                );

                return createNodeRef(childId);
              }

              return item;
            });
            result[key] = refs;
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

    this.viewDataCache.delete(entityId);
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
      const parentId = isNodeRef(parentRef) ? getNodeRefId(parentRef) : null;
      if (!parentId) {
        continue;
      }
      const existing = this.store.read(parentId);
      if (!existing) {
        continue;
      }

      const current = Array.isArray(existing[parent.field])
        ? (existing[parent.field] as Array<unknown>)
        : [];

      if (
        current.some(
          (item) => isNodeRef(item) && getNodeRefId(item) === entityId,
        )
      ) {
        continue;
      }

      if (snapshots && !snapshots.has(parentId)) {
        snapshots.set(parentId, this.store.snapshot(parentId));
      }

      this.viewDataCache.delete(parentId);

      this.store.merge(
        parentId,
        { [parent.field]: [...current, createNodeRef(entityId)] },
        [parent.field],
      );
    }
  }

  private readViewSelection<T extends Entity, S extends Selection<T>>(
    viewComposition: View<T, S>,
    ref: ViewRef<T['__typename']>,
    entityId: EntityId,
  ): ViewData<T, S> {
    const record = this.store.read(entityId) || { id: entityId };

    const walk = (
      viewPayload: object,
      record: FateRecord,
      target: ViewResult,
    ) => {
      for (const [key, selectionKind] of Object.entries(viewPayload)) {
        if (key === ViewKind) {
          continue;
        }

        if (isViewTag(key)) {
          if (!target[ViewsTag]) {
            assignViewTag(target, new Set());
          }

          target[ViewsTag]!.add(key);
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
              const edges = value.map((item) => {
                const entityId = isNodeRef(item) ? getNodeRefId(item) : null;

                if (!entityId) {
                  const edge: FateRecord = { node: null };
                  if (selection.cursor === true) {
                    edge.cursor = undefined;
                  }
                  return edge;
                }

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
              target[key] = value.map((item) => {
                const entityId = isNodeRef(item) ? getNodeRefId(item) : null;

                if (!entityId) {
                  return item;
                }

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
          } else if (isNodeRef(value)) {
            const entityId = getNodeRefId(value);
            const relatedRecord = this.store.read(entityId);
            const { id, type } = parseEntityId(entityId);
            const targetRecord = target[key] as FateRecord;

            targetRecord.id = id;
            targetRecord.__typename = type;

            if (relatedRecord) {
              walk(selectionKind, relatedRecord, targetRecord as ViewResult);
            }
          } else {
            walk(selectionKind, record, target[key] as ViewResult);
          }
        }
      }
    };

    const result: ViewResult = {};

    for (const viewPayload of getViewPayloads(viewComposition, ref)) {
      walk(viewPayload.select, record, result);
    }

    return result as ViewData<T, S>;
  }

  private pendingKey(
    type: string,
    raw: string | number,
    missingFields: '*' | Set<string>,
  ) {
    return `N|${type}|${raw}|${missingFields === '*' ? missingFields : [...missingFields].sort().join(',')}`;
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
