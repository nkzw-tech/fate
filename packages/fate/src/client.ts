import {
  applyArgsPayloadToPlan,
  combineArgsPayload,
  resolvedArgsFromPlan,
  scopeArgsPayload,
} from './args.ts';
import ViewDataCache from './cache.ts';
import { MutationFunction, wrapMutation } from './mutation.ts';
import { createNodeRef, getNodeRefId, isNodeRef } from './node-ref.ts';
import createRef, { assignViewTag, parseEntityId, toEntityId } from './ref.ts';
import { selectionFromView, type SelectionPlan } from './selection.ts';
import { getListKey, List, Store } from './store.ts';
import { Transport } from './transport.ts';
import { Pagination, RequestResult, ViewSnapshot } from './types.js';
import {
  ConnectionMetadata,
  ConnectionTag,
  FateThenable,
  isNodeItem,
  isViewTag,
  ViewKind,
  ViewResult,
  ViewsTag,
  type AnyRecord,
  type Entity,
  type EntityId,
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

const emptySet = new Set<string>();

const groupSelectionByPrefix = (
  select: Set<string>,
): Map<string, Set<string>> => {
  if (select.size === 0) {
    return new Map();
  }

  const result = new Map<string, Set<string>>();

  for (const path of select) {
    const separatorIndex = path.indexOf('.');
    if (separatorIndex === -1) {
      continue;
    }

    const prefix = path.slice(0, separatorIndex);
    const remainder = path.slice(separatorIndex + 1);

    let bucket = result.get(prefix);
    if (!bucket) {
      bucket = new Set();
      result.set(prefix, bucket);
    }

    bucket.add(remainder);
  }

  return result;
};

export class FateClient<
  Mutations extends Record<
    string,
    MutationDefinition<any, any, any>
  > = EmptyMutations,
> {
  private readonly pending = new Map<
    string,
    PromiseLike<ViewSnapshot<any, any>>
  >();
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
    select: Set<string>,
    options: { args?: AnyRecord; plan?: SelectionPlan } = {},
  ): Promise<unknown> {
    if (!this.transport.mutate) {
      throw new Error(`fate: transport does not support mutations.`);
    }

    const baseRecord =
      input && typeof input === 'object' ? (input as AnyRecord) : undefined;
    const inputArgs =
      baseRecord && typeof baseRecord.args === 'object'
        ? (baseRecord.args as AnyRecord)
        : undefined;
    const planArgs = options.plan
      ? resolvedArgsFromPlan(options.plan)
      : undefined;
    const argsPayload = combineArgsPayload(
      combineArgsPayload(inputArgs, options.args),
      planArgs,
    );

    const requestInput =
      argsPayload && baseRecord
        ? ({ ...baseRecord, args: argsPayload } as AnyRecord)
        : argsPayload
          ? ({ args: argsPayload } as AnyRecord)
          : input;

    return await this.transport.mutate(key as any, requestInput as any, select);
  }

  write(
    type: string,
    data: AnyRecord,
    select: Set<string>,
    snapshots?: Map<EntityId, Snapshot>,
    plan?: SelectionPlan,
    pathPrefix: string | null = null,
  ) {
    return this.normalizeEntity(
      type,
      data,
      select,
      snapshots,
      plan,
      pathPrefix,
    );
  }

  deleteRecord(
    type: string,
    id: string | number,
    snapshots?: Map<EntityId, Snapshot>,
    listSnapshots?: Map<string, List>,
  ) {
    const entityId = toEntityId(type, id);

    if (snapshots && !snapshots.has(entityId)) {
      snapshots.set(entityId, this.store.snapshot(entityId));
    }

    this.viewDataCache.invalidate(entityId);
    this.store.deleteRecord(entityId);
    this.store.removeReferencesTo(
      entityId,
      this.viewDataCache,
      snapshots,
      listSnapshots,
    );
  }

  restore(id: EntityId, snapshot: Snapshot) {
    this.viewDataCache.invalidate(id);
    this.store.restore(id, snapshot);
  }

  restoreList(name: string, list?: List) {
    this.store.restoreList(name, list);
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
  ): FateThenable<ViewSnapshot<T, S>> {
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
      return cached as FateThenable<ViewSnapshot<T, S>>;
    }

    const plan = selectionFromView(view, ref);
    const selectedPaths = plan.paths;
    const missing = this.store.missingForSelection(entityId, selectedPaths);

    if (missing.size > 0) {
      const key = this.pendingKey(type, id, missing);
      const pendingPromise = this.pending.get(key) || null;
      if (pendingPromise) {
        return pendingPromise as FateThenable<ViewSnapshot<T, S>>;
      }

      const promise = this.fetchByIdAndNormalize(type, [id], missing, plan)
        .finally(() => this.pending.delete(key))
        .then(() => this.readView<T, S, V>(view, ref));

      this.pending.set(key, promise);

      return promise as unknown as FateThenable<ViewSnapshot<T, S>>;
    }

    const resolvedView = this.readViewSelection<T, S>(
      view,
      ref,
      entityId,
      plan,
    );

    const thenable = {
      status: 'fulfilled' as const,
      then: <TResult1 = ViewSnapshot<T, S>, TResult2 = never>(
        onfulfilled?: (
          value: ViewSnapshot<T, S>,
        ) => TResult1 | PromiseLike<TResult1>,
        onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
      ): PromiseLike<TResult1 | TResult2> =>
        Promise.resolve(resolvedView).then(onfulfilled, onrejected),
      value: resolvedView,
    } as const;

    this.viewDataCache.set(entityId, view, ref, thenable, resolvedView.ids);
    return thenable;
  }

  async loadConnection<V extends View<any, any>>(
    view: V,
    connection: ConnectionMetadata,
    args: Record<string, unknown>,
    options: { direction?: 'forward' | 'backward' } = {},
  ) {
    const direction = options.direction ?? 'forward';
    const owner = parseEntityId(connection.owner);
    const requestArgs = { ...connection.args, ...args };
    if (requestArgs.id === undefined && owner.id) {
      requestArgs.id = owner.id;
    }

    const {
      argsPayload,
      plan,
      selection: nodeSelection,
    } = this.resolveListSelection(view, requestArgs);
    const scopedArgsPayload = scopeArgsPayload(argsPayload, connection.field);

    const parentSelection = new Set<string>();
    for (const path of nodeSelection) {
      parentSelection.add(`${connection.field}.${path}`);
    }

    const [parentRecord] = await this.transport.fetchById(
      owner.type,
      [owner.id],
      parentSelection,
      scopedArgsPayload,
    );

    if (!parentRecord || typeof parentRecord !== 'object') {
      return this.store.getListState(connection.key);
    }

    const list = (parentRecord as AnyRecord)[connection.field] as {
      items: Array<{ cursor: string | undefined; node: unknown }>;
      pagination: Pagination;
    };
    const connectionPayload = Array.isArray(list)
      ? {
          items: list.map((item) => ({ cursor: undefined, node: item })),
          pagination: undefined,
        }
      : list;

    if (!connectionPayload) {
      return this.store.getListState(connection.key);
    }

    const incomingIds: Array<EntityId> = [];
    const incomingCursors: Array<string | undefined> = [];

    const fieldConfig = this.getTypeConfig(owner.type).fields?.[
      connection.field
    ];
    const nodeType =
      (fieldConfig &&
        (fieldConfig === 'scalar'
          ? null
          : 'listOf' in fieldConfig
            ? fieldConfig.listOf
            : null)) ||
      null;

    if (!nodeType) {
      throw new Error(
        `fate: Could not find node type for '${owner.type}.${connection.field}'.`,
      );
    }

    for (const entry of connectionPayload.items) {
      const { node } = entry;
      const id = this.write(nodeType, node, nodeSelection, undefined, plan);
      incomingIds.push(id);
      incomingCursors.push(entry.cursor);
    }

    const previous = this.store.getListState(connection.key);
    const existingIds = previous?.ids ?? [];
    const existingSet = new Set(existingIds);
    const newIds: Array<EntityId> = [];
    const newCursors: Array<string | undefined> = [];

    incomingIds.forEach((id, index) => {
      if (existingSet.has(id)) {
        return;
      }
      newIds.push(id);
      newCursors.push(incomingCursors[index]);
    });

    const nextIds =
      direction === 'forward'
        ? [...existingIds, ...newIds]
        : [...newIds, ...existingIds];

    let nextCursors: Array<string | undefined> | undefined;
    if (
      previous?.cursors ||
      newCursors.some((cursor) => cursor !== undefined)
    ) {
      const baseCursors =
        previous?.cursors ?? Array(existingIds.length).fill(undefined);
      nextCursors =
        direction === 'forward'
          ? [...baseCursors, ...newCursors]
          : [...newCursors, ...baseCursors];
    }

    const previousPagination = previous?.pagination;
    const newPagination = connectionPayload.pagination;

    const nextPagination =
      previousPagination || newPagination
        ? {
            hasNext: !!(newPagination?.hasNext ?? previousPagination?.hasNext),
            hasPrevious: !!(
              newPagination?.hasPrevious ?? previousPagination?.hasPrevious
            ),
            nextCursor:
              newPagination?.nextCursor ?? previousPagination?.nextCursor,
            previousCursor:
              newPagination?.previousCursor ??
              previousPagination?.previousCursor,
          }
        : undefined;

    this.store.setList(connection.key, {
      cursors: nextCursors,
      ids: nextIds,
      pagination: nextPagination,
    });

    const current = this.store.read(connection.owner);
    const existingField = Array.isArray(current?.[connection.field])
      ? (current?.[connection.field] as Array<unknown>) || []
      : [];
    const nodeRefs = newIds.map((id) => createNodeRef(id));
    const nextField =
      direction === 'forward'
        ? [...existingField, ...nodeRefs]
        : [...nodeRefs, ...existingField];

    this.viewDataCache.invalidate(connection.owner);
    this.store.merge(connection.owner, { [connection.field]: nextField }, [
      connection.field,
    ]);

    return this.store.getListState(connection.key);
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
      {
        fields: Set<string>;
        ids: Array<string | number>;
        plan?: SelectionPlan;
        type: string;
      }
    >();

    const promises: Array<Promise<void>> = [];
    for (const [name, item] of Object.entries(request)) {
      if (isNodeItem(item)) {
        const plan = selectionFromView(item.root, null);
        const fields = plan.paths;
        const fieldsSignature = [...fields].slice().sort().join(',');
        const argsSignature = [...plan.args.entries()]
          .map(([path, entry]) => `${path}:${entry.hash}`)
          .sort()
          .join(',');
        const groupKey = `${item.type}#${fieldsSignature}|${argsSignature}`;
        let group = groups.get(groupKey);
        if (!group) {
          group = { fields, ids: [], plan, type: item.type };
          groups.set(groupKey, group);
        }

        for (const raw of item.ids) {
          const entityId = toEntityId(item.type, raw);
          const missing = this.store.missingForSelection(entityId, fields);
          if (missing.size > 0) {
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
          ? this.fetchByIdAndNormalize(
              group.type,
              group.ids,
              group.fields,
              group.plan,
            )
          : Promise.resolve(),
      ),
    ]);
  }

  getRequestResult<R extends Request>(request: R): RequestResult<R> {
    const result: AnyRecord = {};
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
    select: Set<string>,
    plan?: SelectionPlan,
    prefix: string | null = null,
  ) {
    const resolvedArgs = resolvedArgsFromPlan(plan);
    const records = await this.transport.fetchById(
      type,
      ids,
      select,
      resolvedArgs,
    );
    for (const record of records) {
      this.normalizeEntity(
        type,
        record as AnyRecord,
        select,
        undefined,
        plan,
        prefix,
      );
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

    const { argsPayload, plan, selection } = this.resolveListSelection(
      item.root,
      item.args,
    );
    const { items, pagination } = await this.transport.fetchList(
      name,
      selection,
      argsPayload,
    );
    const ids: Array<EntityId> = [];
    const cursors: Array<string | undefined> = [];
    for (const entry of items) {
      const id = this.normalizeEntity(
        item.type,
        entry.node as AnyRecord,
        selection,
        undefined,
        plan,
      );
      ids.push(id);
      cursors.push(entry.cursor);
    }
    this.store.setList(name, {
      cursors,
      ids,
      pagination,
    });
  }

  private resolveListSelection(
    view: View<any, any>,
    args: AnyRecord | undefined,
  ) {
    const plan = selectionFromView(view, null);
    const selection = plan.paths;
    const defaultArgs = resolvedArgsFromPlan(plan);
    const argsPayload = combineArgsPayload(defaultArgs, args);
    applyArgsPayloadToPlan(plan, argsPayload);

    return { argsPayload, plan, selection };
  }

  private normalizeEntity(
    type: string,
    record: AnyRecord,
    select: Set<string>,
    snapshots?: Map<EntityId, Snapshot>,
    plan?: SelectionPlan,
    pathPrefix: string | null = null,
  ): EntityId {
    const config = this.types.get(type);
    if (!config) {
      throw new Error(
        `fate: Found unknown entity type '${type}' in normalization.`,
      );
    }

    const id = config.getId(record);
    const entityId = toEntityId(type, id);
    const result: AnyRecord = {};
    const selectionTree = groupSelectionByPrefix(select);

    if (config.fields) {
      for (const [key, relationDescriptor] of Object.entries(config.fields)) {
        const value = record[key];
        const fieldPath = pathPrefix ? `${pathPrefix}.${key}` : key;
        const fieldArgs = plan?.args.get(fieldPath);
        if (relationDescriptor === 'scalar') {
          result[key] = value;
        } else if (
          relationDescriptor &&
          typeof relationDescriptor === 'object' &&
          'type' in relationDescriptor
        ) {
          const childPaths = selectionTree.get(key) ?? emptySet;
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

            this.normalizeEntity(
              childType,
              value as AnyRecord,
              childPaths,
              snapshots,
              plan,
              fieldPath,
            );
          }
        } else if (
          relationDescriptor &&
          typeof relationDescriptor === 'object' &&
          'listOf' in relationDescriptor
        ) {
          const childPaths = selectionTree.get(key) ?? emptySet;
          const childType = relationDescriptor.listOf;
          const childConfig = this.types.get(childType);
          if (!childConfig) {
            throw new Error(
              `fate: Unknown related type '${childType}' (field '${type}.${key}').`,
            );
          }

          const connection = (() => {
            if (Array.isArray(value)) {
              return {
                items: value.map((item) => ({ node: item })),
              };
            }

            if (value && typeof value === 'object') {
              const record = value as AnyRecord;
              if (Array.isArray(record.items)) {
                return {
                  items: record.items.map((node) => {
                    if (node && typeof node === 'object' && 'node' in node) {
                      const itemRecord = node as AnyRecord;
                      return {
                        cursor: itemRecord.cursor,
                        node: itemRecord.node,
                      };
                    }

                    return { node };
                  }),
                  pagination: record.pagination,
                };
              }
            }

            return null;
          })();

          if (connection) {
            const refs: Array<unknown> = [];
            const ids: Array<EntityId> = [];
            const cursors: Array<string | undefined> = [];
            let hasCursor = false;

            const nodeSelection =
              childPaths.size > 0 ? new Set<string>() : childPaths;

            if (childPaths.size > 0) {
              for (const path of childPaths) {
                if (path.startsWith('items.node.')) {
                  nodeSelection.add(path.slice('items.node.'.length));
                  continue;
                }

                if (path.startsWith('node.')) {
                  nodeSelection.add(path.slice('node.'.length));
                  continue;
                }

                if (path === 'items.node' || path.startsWith('items.')) {
                  continue;
                }

                nodeSelection.add(path);
              }
            }

            for (const entry of connection.items) {
              const node = entry.node;
              const cursor =
                'cursor' in entry ? (entry.cursor as string) : undefined;
              cursors.push(cursor);
              if (cursor !== undefined) {
                hasCursor = true;
              }
              if (isNodeRef(node)) {
                refs.push(node);
                ids.push(getNodeRefId(node));
                continue;
              }

              if (node && typeof node === 'object') {
                const childId = toEntityId(
                  childType,
                  childConfig.getId(node as AnyRecord),
                );

                this.normalizeEntity(
                  childType,
                  node as AnyRecord,
                  nodeSelection,
                  snapshots,
                  plan,
                  fieldPath,
                );

                refs.push(createNodeRef(childId));
                ids.push(childId);
                continue;
              }

              refs.push(node);
            }

            result[key] = refs;

            this.store.setList(getListKey(entityId, key, fieldArgs?.hash), {
              cursors: hasCursor ? cursors : undefined,
              ids,
              pagination: connection.pagination as List['pagination'],
            });
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

    this.viewDataCache.invalidate(entityId);
    this.store.merge(entityId, result, select);
    this.linkParentLists(type, entityId, result, snapshots);
    return entityId;
  }

  private linkParentLists(
    type: string,
    entityId: EntityId,
    record: AnyRecord,
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

      this.viewDataCache.invalidate(parentId);

      const nextList = [...current, createNodeRef(entityId)];

      const listKey = getListKey(parentId, parent.field);
      const ids = nextList
        .map((item) => (isNodeRef(item) ? getNodeRefId(item) : null))
        .filter((id): id is EntityId => id != null);

      this.store.setList(listKey, { ids });
      this.store.merge(parentId, { [parent.field]: nextList }, [parent.field]);
    }
  }

  private readViewSelection<T extends Entity, S extends Selection<T>>(
    viewComposition: View<T, S>,
    ref: ViewRef<T['__typename']>,
    entityId: EntityId,
    plan: SelectionPlan,
    pathPrefix: string | null = null,
  ): ViewSnapshot<T, S> {
    const record = this.store.read(entityId) || { id: entityId };
    const ids = new Set<EntityId>();
    ids.add(entityId);

    const walk = (
      viewPayload: object,
      record: AnyRecord,
      target: ViewResult,
      parentId: EntityId,
      prefix: string | null,
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

        const fieldPath = prefix ? `${prefix}.${key}` : key;
        const selectionType = typeof selectionKind;
        if (selectionType === 'boolean' && selectionKind) {
          target[key] = record[key];
        } else if (selectionKind && selectionType === 'object') {
          const selectionValue = selectionKind as AnyRecord;
          const { args: selectionArgs, ...selectionWithoutArgs } =
            selectionValue;
          const hasArgsOnly =
            Boolean(selectionArgs) &&
            typeof selectionArgs === 'object' &&
            Object.keys(selectionWithoutArgs).length === 0;

          if (hasArgsOnly) {
            target[key] = record[key];
            continue;
          }

          if (!(key in target)) {
            target[key] = {};
          }

          const nextSelection = Object.keys(selectionWithoutArgs).length
            ? selectionWithoutArgs
            : selectionValue;

          const value = record[key];
          if (Array.isArray(value)) {
            if (
              nextSelection.items &&
              typeof nextSelection.items === 'object'
            ) {
              const selection = nextSelection.items as AnyRecord;
              const fieldArgs = plan.args.get(fieldPath);
              const listKey = getListKey(parentId, key, fieldArgs?.hash);
              const listState = this.store.getListState(listKey);
              const items = value.map((item, index) => {
                const entityId = isNodeRef(item) ? getNodeRefId(item) : null;

                if (!entityId) {
                  const entry: AnyRecord = {
                    cursor: listState?.cursors?.[index],
                    node: null,
                  };
                  return entry;
                }

                ids.add(entityId);
                const record = this.store.read(entityId);
                const { id, type } = parseEntityId(entityId);
                const node = { __typename: type, id };

                if (record) {
                  walk(
                    selection.node as AnyRecord,
                    record,
                    node,
                    entityId,
                    fieldPath,
                  );
                }

                const entry: AnyRecord = {
                  node: record ? node : null,
                };

                if (selection.cursor === true) {
                  entry.cursor = listState?.cursors?.[index];
                }
                return entry;
              });
              const connection: AnyRecord = { items };
              if ('pagination' in nextSelection && nextSelection.pagination) {
                const paginationSelection =
                  nextSelection.pagination as AnyRecord;
                const storedPagination = listState?.pagination;
                if (storedPagination) {
                  const pagination: AnyRecord = {};
                  if (paginationSelection.nextCursor === true) {
                    if (storedPagination.nextCursor !== undefined) {
                      pagination.nextCursor = storedPagination.nextCursor;
                    }
                  }
                  if (paginationSelection.previousCursor === true) {
                    if (storedPagination.previousCursor !== undefined) {
                      pagination.previousCursor =
                        storedPagination.previousCursor;
                    }
                  }
                  if (paginationSelection.hasNext === true) {
                    pagination.hasNext = storedPagination.hasNext;
                  }
                  if (paginationSelection.hasPrevious === true) {
                    pagination.hasPrevious = storedPagination.hasPrevious;
                  }
                  if (Object.keys(pagination).length > 0) {
                    connection.pagination = pagination;
                  }
                } else {
                  connection.pagination = undefined;
                }
              }
              const { id: ownerRawId, type: parentType } =
                parseEntityId(parentId);
              if (parentType) {
                const metadataArgs = (() => {
                  if (!fieldArgs?.value && ownerRawId === undefined) {
                    return undefined;
                  }
                  const value = fieldArgs?.value
                    ? { ...fieldArgs.value }
                    : ({} as AnyRecord);
                  if (ownerRawId !== undefined) {
                    value.id = ownerRawId;
                  }
                  return value;
                })();
                const metadata: ConnectionMetadata = {
                  args: metadataArgs,
                  field: key,
                  hash: fieldArgs?.hash,
                  key: listKey,
                  owner: parentId,
                  procedure: `${parentType}.${key}`,
                };
                Object.defineProperty(connection, ConnectionTag, {
                  configurable: false,
                  enumerable: false,
                  value: metadata,
                  writable: false,
                });
              }
              target[key] = connection;
            } else {
              target[key] = value.map((item) => {
                const entityId = isNodeRef(item) ? getNodeRefId(item) : null;

                if (!entityId) {
                  return item;
                }

                ids.add(entityId);
                const record = this.store.read(entityId);
                const { id, type } = parseEntityId(entityId);

                if (record) {
                  const node = { __typename: type, id };
                  walk(nextSelection, record, node, entityId, fieldPath);
                  return node;
                }

                return null;
              });
            }
          } else if (isNodeRef(value)) {
            const entityId = getNodeRefId(value);
            ids.add(entityId);
            const relatedRecord = this.store.read(entityId);
            const { id, type } = parseEntityId(entityId);
            const targetRecord = target[key] as AnyRecord;

            targetRecord.id = id;
            targetRecord.__typename = type;

            if (relatedRecord) {
              walk(
                nextSelection,
                relatedRecord,
                targetRecord as ViewResult,
                entityId,
                fieldPath,
              );
            }
          } else {
            walk(
              nextSelection,
              record,
              target[key] as ViewResult,
              entityId,
              fieldPath,
            );
          }
        }
      }
    };

    const data: ViewResult = {};

    for (const viewPayload of getViewPayloads(viewComposition, ref)) {
      walk(viewPayload.select, record, data, entityId, pathPrefix);
    }

    return { data: data as ViewData<T, S>, ids };
  }

  private pendingKey(
    type: string,
    raw: string | number,
    missingFields: Set<string>,
  ) {
    return `N|${type}|${raw}|${[...missingFields].sort().join(',')}`;
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
