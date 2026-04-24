import { combineArgsPayload, resolvedArgsFromPlan, scopeArgsPayload } from './args.ts';
import ViewDataCache from './cache.ts';
import { cloneMask, fromPaths, isCovered, union, type FieldMask } from './mask.ts';
import {
  FateMutations,
  InsertPosition,
  MutationActionsFor,
  MutationFunction,
  MutationFunctionsFor,
  MutationOptions,
  wrapMutation,
} from './mutation.ts';
import { createNodeRef, getNodeRefId, isNodeRef } from './node-ref.ts';
import OperationLifetime, { type RetainHandle } from './operation-lifetime.ts';
import createRef, {
  assignViewTag,
  createRefWithViewNames,
  parseEntityId,
  toEntityId,
} from './ref.ts';
import {
  createRequestDescriptor,
  getPaginationArgsInfo,
  resolveSelectionPlan,
  type ListRequestDescriptor,
  type QueryRequestDescriptor,
  type RequestDescriptor,
} from './request-descriptor.ts';
import FateRequestPromise from './request-promise.ts';
import { getSelectionPlan, type SelectionPlan } from './selection.ts';
import { getListKey, List, Store } from './store.ts';
import { Transport } from './transport.ts';
import {
  ConnectionMetadata,
  ConnectionTag,
  isViewTag,
  ViewResult,
  ViewsTag,
  type AnyRecord,
  type Entity,
  type EntityId,
  type FateThenable,
  type MutationIdentifier,
  type MutationMapFromDefinitions,
  type Pagination,
  type Request,
  type RequestResult,
  type Selection,
  type Snapshot,
  type TypeConfig,
  type View,
  type ViewData,
  type ViewRef,
  type ViewSnapshot,
  FateRoots,
  MutationDefinition,
  RootDefinition,
} from './types.ts';
import { getViewNames, getViewPayloads } from './view.ts';

/**
 * Strategy used when resolving a request.
 */
export type RequestMode =
  /** (default) Use cached data if present, otherwise fetch. */
  | 'cache-first'
  /** Show cached data immediately and refresh in the background. */
  | 'stale-while-revalidate'
  /** Always fetch from the network and ignore cached entries. */
  | 'network-only';

/**
 * Request options that affect how requests are fetched and retained.
 */
export type RequestOptions = Readonly<{ mode?: RequestMode }>;

type FateClientOptions<Roots extends FateRoots, Mutations extends FateMutations> = {
  /**
   * Number of recently released requests to keep retained before their records
   * and lists are eligible for garbage collection.
   *
   * @defaultValue 10
   */
  gcReleaseBufferSize?: number;
  mutations?: Mutations;
  roots: Roots;
  transport: Transport<MutationMapFromDefinitions<Mutations>>;
  types: ReadonlyArray<Omit<TypeConfig, 'getId'> & Partial<{ getId: TypeConfig['getId'] }>>;
};

const getId: TypeConfig['getId'] = (record: unknown) => {
  if (!record || typeof record !== 'object' || !('id' in record)) {
    throw new Error(`fate: Missing 'id' on entity record.`);
  }

  const value = (record as { id: string | number }).id;
  const valueType = typeof value;
  if (valueType !== 'string' && valueType !== 'number') {
    throw new Error(`fate: Entity id must be a string or number, received '${valueType}'.`);
  }
  return value;
};

const emptySet = new Set<string>();

type ListEntry = Readonly<{ cursor?: string; id: EntityId }>;

const dropCanonicalPendingIds = (
  pendingIds: ReadonlyArray<EntityId> | undefined,
  ids: ReadonlyArray<EntityId>,
) => {
  if (!pendingIds || pendingIds.length === 0) {
    return undefined;
  }

  const canonicalIds = new Set(ids);
  const next = pendingIds.filter((id) => !canonicalIds.has(id));
  return next.length > 0 ? next : undefined;
};

const getListEntries = (listState: List | undefined): Array<ListEntry> => {
  if (!listState) {
    return [];
  }

  const entries: Array<ListEntry> = [];

  for (const id of listState.pendingBeforeIds ?? []) {
    entries.push({ id });
  }

  listState.ids.forEach((id, index) => {
    entries.push({ cursor: listState.cursors?.[index], id });
  });

  for (const id of listState.pendingAfterIds ?? []) {
    entries.push({ id });
  }

  return entries;
};

const rootListRefWithViewNames = (entityId: EntityId, viewNames: ReadonlySet<string>) => {
  const { id, type } = parseEntityId(entityId);
  return createRefWithViewNames(type, id, viewNames);
};

const setNestedValue = (target: AnyRecord, key: string, value: unknown) => {
  const path = key.split('.');
  let current: AnyRecord = target;

  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    const isLeaf = index === path.length - 1;

    if (!segment) {
      continue;
    }

    if (isLeaf) {
      current[segment] = value;
      return;
    }

    current[segment] = (current[segment] as AnyRecord | undefined) ?? Object.create(null);
    current = current[segment] as AnyRecord;
  }
};

const omitUndefinedValues = (record: AnyRecord): AnyRecord => {
  const result: AnyRecord = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
};

const groupSelectionByPrefix = (select: ReadonlySet<string>): ReadonlyMap<string, Set<string>> => {
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

/**
 * Core client that normalizes records, manages the view cache, and coordinates
 * data fetching.
 */
export class FateClient<Roots extends FateRoots, Mutations extends FateMutations> {
  private readonly mutationMap: Record<string, MutationFunction<any>>;
  private readonly parentLists = new Map<
    string,
    Array<{ field: string; parentType: string; via?: string }>
  >();
  private readonly rootLists = new Map<string, Set<string>>();
  private readonly pending = new Map<string, PromiseLike<ViewSnapshot<any, any>>>();
  private readonly pendingOptimisticMutations = new Map<EntityId, Set<Promise<unknown>>>();
  private readonly optimisticMasks = new Map<number, { entityId: EntityId; mask: FieldMask }>();
  private readonly optimisticByEntity = new Map<EntityId, Set<number>>();
  private readonly optimisticEntityResolutions = new Map<EntityId, EntityId>();
  private optimisticTokenCounter = 0;
  private readonly requests = new Map<
    string,
    Map<RequestMode, FateRequestPromise<RequestResult<Roots, Request>, RequestDescriptor>>
  >();
  private readonly rootRequests = new Map<string, EntityId | null>();
  private readonly stalledRequests = new Set<string>();
  private gcPending = false;
  private gcScheduled = false;
  readonly store = new Store();
  private readonly operationLifetime: OperationLifetime;
  private readonly types: ReadonlyMap<string, TypeConfig>;
  private readonly transport: Transport<MutationMapFromDefinitions<Mutations>>;
  private readonly viewDataCache = new ViewDataCache();

  readonly actions: MutationActionsFor<Mutations>;
  readonly mutations: MutationFunctionsFor<Mutations>;
  readonly roots: Roots;

  constructor(options: FateClientOptions<Roots, Mutations>) {
    this.actions = Object.create(null) as MutationActionsFor<Mutations>;
    this.mutationMap = Object.create(null);
    this.mutations = Object.create(null) as MutationFunctionsFor<Mutations>;
    this.operationLifetime = new OperationLifetime(options.gcReleaseBufferSize ?? 10);
    this.roots = options.roots;
    this.transport = options.transport;
    this.types = new Map(options.types.map((entity) => [entity.type, { getId, ...entity }]));

    if (options.mutations) {
      for (const [key, definition] of Object.entries(options.mutations)) {
        const mutation = wrapMutation(this, { ...definition, key });
        this.mutationMap[key] = mutation;

        setNestedValue(this.mutations as AnyRecord, key, mutation);

        setNestedValue(
          this.actions as AnyRecord,
          key,
          async <I extends MutationIdentifier<any, any, any>>(
            _previousState: unknown,
            data: MutationOptions<I> | 'reset',
          ) => (data === 'reset' ? null : await this.mutationMap[key](data)),
        );
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
        if (descriptor && typeof descriptor === 'object' && 'listOf' in descriptor) {
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
          for (const [childField, childDescriptor] of Object.entries(childConfig.fields)) {
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

  private registerRootList(type: string, key: string) {
    let lists = this.rootLists.get(type);
    if (!lists) {
      lists = new Set();
      this.rootLists.set(type, lists);
    }

    lists.add(key);
  }

  private snapshotList(key: string, listSnapshots: Map<string, List> | undefined) {
    if (!listSnapshots || listSnapshots.has(key)) {
      return;
    }

    const listState = this.store.getListState(key);
    if (listState) {
      listSnapshots.set(key, listState);
    }
  }

  private applyListInsert(
    listState: List,
    entityId: EntityId,
    insert: InsertPosition,
  ): { list: List; pending: boolean } {
    const pendingBeforeIds = listState.pendingBeforeIds ?? [];
    const pendingAfterIds = listState.pendingAfterIds ?? [];
    const hasEntity =
      listState.ids.includes(entityId) ||
      pendingBeforeIds.includes(entityId) ||
      pendingAfterIds.includes(entityId);

    if (hasEntity) {
      return { list: listState, pending: false };
    }

    const shouldStayPending =
      insert === 'before'
        ? Boolean(listState.pagination?.hasPrevious)
        : Boolean(listState.pagination?.hasNext);

    if (shouldStayPending) {
      return {
        list:
          insert === 'before'
            ? {
                ...listState,
                pendingBeforeIds: [entityId, ...pendingBeforeIds],
              }
            : {
                ...listState,
                pendingAfterIds: [...pendingAfterIds, entityId],
              },
        pending: true,
      };
    }

    const ids = insert === 'before' ? [entityId, ...listState.ids] : [...listState.ids, entityId];
    const cursors = listState.cursors
      ? insert === 'before'
        ? [undefined, ...listState.cursors]
        : [...listState.cursors, undefined]
      : listState.cursors;

    return {
      list: {
        ...listState,
        cursors,
        ids,
      },
      pending: false,
    };
  }

  private insertIntoRootLists(
    type: string,
    entityId: EntityId,
    insert: InsertPosition,
    listSnapshots?: Map<string, List>,
  ) {
    if (insert === 'none') {
      return;
    }

    const listNames = this.rootLists.get(type);
    if (!listNames) {
      return;
    }

    for (const key of listNames) {
      const listState = this.store.getListState(key);
      if (!listState) {
        continue;
      }

      const next = this.applyListInsert(listState, entityId, insert).list;
      if (next === listState) {
        continue;
      }

      this.snapshotList(key, listSnapshots);
      this.store.setList(key, next);
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
      throw new Error(
        `fate: transport does not support mutations. Please provide a 'mutate' implementation in your transport.`,
      );
    }

    const baseRecord = input && typeof input === 'object' ? (input as AnyRecord) : undefined;
    const inputArgs =
      baseRecord && typeof baseRecord.args === 'object'
        ? (baseRecord.args as AnyRecord)
        : undefined;
    const argsPayload = combineArgsPayload(
      options.plan ? resolvedArgsFromPlan(options.plan) : undefined,
      combineArgsPayload(inputArgs, options.args),
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
    select: ReadonlySet<string>,
    snapshots?: Map<EntityId, Snapshot>,
    plan?: SelectionPlan,
    pathPrefix: string | null = null,
    blockedMask?: FieldMask | null,
    insert?: InsertPosition,
    listSnapshots?: Map<string, List>,
  ) {
    return this.writeEntity(
      type,
      data,
      select,
      snapshots,
      plan,
      pathPrefix,
      blockedMask,
      insert,
      listSnapshots,
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
    this.store.removeReferencesTo(entityId, this.viewDataCache, snapshots, listSnapshots);
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
      const received = Object.keys(ref).length > 0 ? `'${JSON.stringify(ref)}'` : 'an empty object';

      throw new Error(
        `fate: Invalid view reference. Expected 'id' to be provided as part of the reference, received ${received}. Did you forget to spread the correct view into its parent or pass the wrong ref to 'useView'?`,
      );
    }

    if (type == null) {
      throw new Error(
        `fate: Invalid view reference. Expected '__typename' to be provided as part of the reference, received '${JSON.stringify(ref)}'.`,
      );
    }

    const entityId = toEntityId(type, id);
    const resolvedEntityId = this.optimisticEntityResolutions.get(entityId) ?? null;
    if (resolvedEntityId && resolvedEntityId !== entityId) {
      const { id: resolvedId, type: resolvedType } = parseEntityId(resolvedEntityId);
      return this.readView<T, S, V>(view, createRef(resolvedType, resolvedId, view));
    }
    const viewNames = getViewNames(view);
    const refViews = ref[ViewsTag];

    if (!refViews || ![...viewNames].every((name) => refViews.has(name))) {
      const received = refViews ? [...refViews].join(', ') : JSON.stringify(ref);

      throw new Error(
        `fate: Invalid view reference. Expected the provided ref to include the view(s) '${[...viewNames].join("', '")}', received '${received}'. You can fix this issue by spreading the correct view into its parent so fate can create the correct view refs for you.`,
      );
    }

    const cached = this.viewDataCache.get(entityId, view, ref);
    if (cached) {
      return cached as FateThenable<ViewSnapshot<T, S>>;
    }

    const plan = getSelectionPlan(view, ref);
    const selectedPaths = plan.paths;
    const missing = this.store.missingForSelection(entityId, selectedPaths);

    const resolveSnapshot = () => {
      const resolvedView = this.readViewSelection<T, S>(view, ref, entityId, plan);

      const thenable = {
        status: 'fulfilled',
        then: <TResult1 = ViewSnapshot<T, S>, TResult2 = never>(
          onfulfilled?: (value: ViewSnapshot<T, S>) => TResult1 | PromiseLike<TResult1>,
          onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
        ): PromiseLike<TResult1 | TResult2> =>
          Promise.resolve(resolvedView).then(onfulfilled, onrejected),
        value: resolvedView,
      } as const;

      this.viewDataCache.set(
        entityId,
        view,
        ref,
        thenable,
        new Set(resolvedView.coverage.map(([id]) => id)),
      );
      return thenable;
    };

    if (missing.size === 0) {
      this.clearStalledRequestsForEntity(entityId);
      return resolveSnapshot();
    }

    if (missing.size > 0) {
      const key = this.pendingKey(entityId, missing);

      const pendingOptimistic = this.getPendingOptimisticMutations(entityId);
      if (pendingOptimistic) {
        const pending = this.pending.get(key);
        if (pending) {
          return pending as FateThenable<ViewSnapshot<T, S>>;
        }

        const promise = Promise.all(pendingOptimistic)
          .then(() => this.readView<T, S, V>(view, ref))
          .finally(() => this.pending.delete(key));

        this.pending.set(key, promise);
        return promise as unknown as FateThenable<ViewSnapshot<T, S>>;
      }
      if (this.stalledRequests.has(key)) {
        return resolveSnapshot();
      }

      const pendingPromise = this.pending.get(key) || null;
      if (pendingPromise) {
        return pendingPromise as FateThenable<ViewSnapshot<T, S>>;
      }

      const promise = this.fetchByIdAndNormalize(type, [id], missing, plan)
        .finally(() => this.pending.delete(key))
        .then(() => {
          const remainingMissing = this.store.missingForSelection(entityId, selectedPaths);

          if (remainingMissing.size > 0) {
            this.stalledRequests.add(key);
            return resolveSnapshot();
          }

          this.stalledRequests.delete(key);
          return this.readView<T, S, V>(view, ref);
        });

      this.pending.set(key, promise);

      return promise as unknown as FateThenable<ViewSnapshot<T, S>>;
    }
    return resolveSnapshot();
  }

  private mergeListState(
    previous: List | undefined,
    incomingIds: ReadonlyArray<EntityId>,
    incomingCursors: ReadonlyArray<string | undefined>,
    incomingPagination: Pagination | undefined,
    options: { direction: 'forward' | 'backward'; hasCursorArg: boolean },
  ): List {
    const existingIds = previous?.ids ?? [];
    const existingSet = new Set(existingIds);
    const isBackward = options.direction === 'backward';

    const mergeIds = () => {
      if (!previous) {
        return [...incomingIds];
      }

      if (!options.hasCursorArg) {
        const incomingSet = new Set(incomingIds);
        const remaining = existingIds.filter((id) => !incomingSet.has(id));
        return isBackward ? [...remaining, ...incomingIds] : [...incomingIds, ...remaining];
      }

      const newIds = incomingIds.filter((id) => !existingSet.has(id));
      return isBackward ? [...newIds, ...existingIds] : [...existingIds, ...newIds];
    };

    const ids = mergeIds();
    const hasIncomingCursor = incomingCursors.some((cursor) => cursor !== undefined);

    const cursorMap = new Map<EntityId, string | undefined>();
    if (previous?.cursors) {
      previous.cursors.forEach((cursor, index) => {
        cursorMap.set(existingIds[index], cursor);
      });
    }
    incomingCursors.forEach((cursor, index) => {
      if (cursor !== undefined) {
        cursorMap.set(incomingIds[index], cursor);
      }
    });

    const shouldStoreCursors =
      hasIncomingCursor || Boolean(previous?.cursors) || options.hasCursorArg;
    const cursors = shouldStoreCursors ? ids.map((id) => cursorMap.get(id)) : undefined;

    const previousPagination = previous?.pagination;
    const newPagination = incomingPagination;

    const pagination =
      previousPagination || newPagination
        ? {
            hasNext: !!(newPagination?.hasNext ?? previousPagination?.hasNext),
            hasPrevious: !!(newPagination?.hasPrevious ?? previousPagination?.hasPrevious),
            nextCursor: newPagination?.nextCursor ?? previousPagination?.nextCursor,
            previousCursor: newPagination?.previousCursor ?? previousPagination?.previousCursor,
          }
        : undefined;

    return {
      cursors,
      ids,
      pagination,
      pendingAfterIds: dropCanonicalPendingIds(previous?.pendingAfterIds, ids),
      pendingBeforeIds: dropCanonicalPendingIds(previous?.pendingBeforeIds, ids),
    };
  }

  registerPendingOptimisticMutation(entityId: EntityId, promise: Promise<unknown>) {
    let entries = this.pendingOptimisticMutations.get(entityId);
    if (!entries) {
      entries = new Set();
      this.pendingOptimisticMutations.set(entityId, entries);
    }

    const trackedPromise = promise.catch(() => undefined);
    entries.add(trackedPromise);

    trackedPromise.finally(() => {
      const current = this.pendingOptimisticMutations.get(entityId);
      if (!current) {
        return;
      }

      current.delete(trackedPromise);
      if (current.size === 0) {
        this.pendingOptimisticMutations.delete(entityId);
      }

      this.runPendingGarbageCollection();
    });
  }

  resolveOptimisticEntity(optimisticEntityId: EntityId, resolvedEntityId: EntityId) {
    this.optimisticEntityResolutions.set(optimisticEntityId, resolvedEntityId);
    this.store.replaceListEntityId(optimisticEntityId, resolvedEntityId);
  }

  registerOptimisticUpdate(entityId: EntityId | null, select: ReadonlySet<string>): number | null {
    if (!entityId || select.size === 0) {
      return null;
    }

    const mask = fromPaths(select);
    const token = ++this.optimisticTokenCounter;
    this.optimisticMasks.set(token, { entityId, mask });

    let entries = this.optimisticByEntity.get(entityId);
    if (!entries) {
      entries = new Set();
      this.optimisticByEntity.set(entityId, entries);
    }
    entries.add(token);

    return token;
  }

  clearOptimisticUpdate(token: number | null) {
    if (token == null) {
      return;
    }

    const entry = this.optimisticMasks.get(token);
    if (!entry) {
      return;
    }

    this.optimisticMasks.delete(token);
    const entityTokens = this.optimisticByEntity.get(entry.entityId);
    if (entityTokens) {
      entityTokens.delete(token);
      if (entityTokens.size === 0) {
        this.optimisticByEntity.delete(entry.entityId);
      }
    }

    this.runPendingGarbageCollection();
  }

  getPendingOptimisticMask(
    entityId: EntityId | null,
    options: { excludeToken?: number | null } = {},
  ): FieldMask | null {
    if (!entityId) {
      return null;
    }
    const tokens = this.optimisticByEntity.get(entityId);
    if (!tokens || tokens.size === 0) {
      return null;
    }

    let mask: FieldMask | null = null;

    for (const token of tokens) {
      if (options.excludeToken != null && token === options.excludeToken) {
        continue;
      }

      const entry = this.optimisticMasks.get(token);
      if (!entry) {
        continue;
      }

      if (!mask) {
        mask = cloneMask(entry.mask);
      } else {
        union(mask, entry.mask);
      }
    }

    return mask;
  }

  private getPendingOptimisticMutations(
    entityId: EntityId,
  ): ReadonlyArray<Promise<unknown>> | null {
    const pending = this.pendingOptimisticMutations.get(entityId);
    return pending && pending.size > 0 ? [...pending] : null;
  }

  filterSelectionForPendingOptimistics(
    entityId: EntityId | null,
    select: Set<string>,
    options: { excludeToken?: number | null } = {},
  ): Set<string> {
    if (!entityId || select.size === 0) {
      return select;
    }

    const pendingMask = this.getPendingOptimisticMask(entityId, options);
    if (!pendingMask) {
      return select;
    }

    const filtered = new Set<string>();
    for (const path of select) {
      if (!isCovered(pendingMask, path)) {
        filtered.add(path);
      }
    }

    return filtered;
  }

  async loadConnection<V extends View<any, any>>(
    view: V,
    connection: ConnectionMetadata,
    args: Record<string, unknown>,
    options: { direction?: 'forward' | 'backward' } = {},
  ) {
    const direction = options.direction ?? 'forward';
    if (connection.root) {
      if (!this.transport.fetchList) {
        throw new Error(
          `fate: transport does not support list fetching. Please add support for 'fetchList' in your transport.`,
        );
      }

      const requestArgs = omitUndefinedValues({ ...connection.args, ...args });
      const { argsPayload, plan } = resolveSelectionPlan(view, requestArgs);
      const { items, pagination } = await this.transport.fetchList(
        connection.field,
        plan.paths,
        argsPayload,
      );

      if (!items) {
        return this.store.getListState(connection.key);
      }

      const incomingIds: Array<EntityId> = [];
      const incomingCursors: Array<string | undefined> = [];

      for (const entry of items) {
        const id = this.write(
          connection.type,
          entry.node as AnyRecord,
          plan.paths,
          undefined,
          plan,
          null,
          null,
          'none',
        );
        incomingIds.push(id);
        incomingCursors.push(entry.cursor);
      }

      const previous = this.store.getListState(connection.key);
      const argsValue = args as AnyRecord | undefined;
      const paginationArgs = getPaginationArgsInfo(argsValue);

      const nextListState = this.mergeListState(
        previous,
        incomingIds,
        incomingCursors,
        pagination,
        paginationArgs,
      );

      if (!connection.args) {
        this.registerRootList(connection.type, connection.key);
      }
      this.store.setList(connection.key, nextListState);

      return nextListState;
    }

    const owner = parseEntityId(connection.owner);
    const requestArgs = omitUndefinedValues({ ...connection.args, ...args });
    if (requestArgs.id === undefined && owner.id) {
      requestArgs.id = owner.id;
    }

    const { argsPayload, plan } = resolveSelectionPlan(view, requestArgs);
    const nodeSelection = plan.paths;
    const scopedArgsPayload = argsPayload
      ? scopeArgsPayload(argsPayload, connection.field)
      : undefined;

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

    const fieldConfig = this.getTypeConfig(owner.type).fields?.[connection.field];
    const nodeType =
      (fieldConfig &&
        (fieldConfig === 'scalar' ? null : 'listOf' in fieldConfig ? fieldConfig.listOf : null)) ||
      null;

    if (!nodeType) {
      throw new Error(`fate: Could not find node type for '${owner.type}.${connection.field}'.`);
    }

    for (const entry of connectionPayload.items) {
      const { node } = entry;
      const id = this.write(nodeType, node, nodeSelection, undefined, plan);
      incomingIds.push(id);
      incomingCursors.push(entry.cursor);
    }

    const previous = this.store.getListState(connection.key);
    const previousIds = previous?.ids ?? [];
    const previousSet = new Set(previousIds);
    const newIds = incomingIds.filter((id) => !previousSet.has(id));
    const nextListState = this.mergeListState(
      previous,
      incomingIds,
      incomingCursors,
      connectionPayload.pagination,
      { direction, hasCursorArg: true },
    );

    this.store.setList(connection.key, nextListState);

    const current = this.store.read(connection.owner);
    const existingField = Array.isArray(current?.[connection.field])
      ? (current?.[connection.field] as Array<unknown>) || []
      : [];
    const nodeRefs = newIds.map((id) => createNodeRef(id));
    const nextField =
      direction === 'forward' ? [...existingField, ...nodeRefs] : [...nodeRefs, ...existingField];

    this.viewDataCache.invalidate(connection.owner);
    this.store.merge(connection.owner, { [connection.field]: nextField }, [connection.field]);

    return this.store.getListState(connection.key);
  }

  request<R extends Request>(
    request: R,
    options?: RequestOptions,
  ): Promise<RequestResult<Roots, R>> {
    const mode = options?.mode ?? 'cache-first';
    const descriptor = this.createRequestDescriptor(request);
    const requestKey = descriptor.key;
    const existingRequest = this.requests.get(requestKey)?.get(mode);
    if (existingRequest) {
      if (
        mode === 'cache-first' &&
        (existingRequest.status === 'rejected' ||
          (existingRequest.status === 'fulfilled' &&
            !this.hasRequestData(existingRequest.descriptor)))
      ) {
        this.executeRequestHandle(existingRequest, mode);
      }

      return existingRequest as unknown as Promise<RequestResult<Roots, R>>;
    }

    const handle = new FateRequestPromise<RequestResult<Roots, Request>, RequestDescriptor>(
      descriptor,
      () => this.getRequestResultFromDescriptor(descriptor),
    );

    let requests = this.requests.get(requestKey);
    if (!requests) {
      requests = new Map();
      this.requests.set(requestKey, requests);
    }

    requests.set(mode, handle);
    this.executeRequestHandle(handle, mode);

    return handle as unknown as Promise<RequestResult<Roots, R>>;
  }

  releaseRequest(request: Request, mode: RequestMode): void {
    const requestKey = this.createRequestDescriptor(request).key;
    const requests = this.requests.get(requestKey);
    if (!requests) {
      return;
    }

    requests.delete(mode);
    if (requests.size === 0) {
      this.requests.delete(requestKey);
    }
  }

  /**
   * Keeps the records and lists reachable from a request alive until the
   * returned handle is disposed.
   *
   * `useRequest` calls this automatically while the component is mounted.
   * Use it directly for non-React request lifetimes, tests, or preloaded data
   * that must survive manual garbage collection.
   */
  retain(request: Request): RetainHandle {
    return this.operationLifetime.retain(this.createRequestDescriptor(request), () =>
      this.scheduleGarbageCollection(),
    );
  }

  private scheduleGarbageCollection() {
    if (this.gcScheduled) {
      return;
    }

    this.gcScheduled = true;
    queueMicrotask(() => {
      this.gcScheduled = false;
      this.gc();
    });
  }

  /**
   * Removes records and lists that are not reachable from retained requests or
   * the release buffer.
   *
   * Garbage collection is scheduled automatically when retained requests are
   * released. Calling this method manually is mainly useful in tests and custom
   * memory-management flows.
   */
  gc(): void {
    if (this.hasActiveOptimisticUpdates()) {
      this.gcPending = true;
      return;
    }

    this.gcPending = false;

    const markedLists = new Set<string>();
    const markedRecords = new Set<EntityId>();
    const queue: Array<EntityId> = [];

    const markRecord = (entityId: EntityId | null | undefined) => {
      if (!entityId || markedRecords.has(entityId)) {
        return;
      }

      markedRecords.add(entityId);
      queue.push(entityId);
    };

    const markList = (key: string) => {
      markedLists.add(key);
      const listState = this.store.getListState(key);
      if (!listState) {
        return;
      }

      for (const id of listState.pendingBeforeIds ?? []) {
        markRecord(id);
      }

      for (const id of listState.ids) {
        markRecord(id);
      }

      for (const id of listState.pendingAfterIds ?? []) {
        markRecord(id);
      }
    };

    for (const descriptor of this.operationLifetime.getDescriptors()) {
      for (const item of descriptor.items) {
        if (item.kind === 'node' || item.kind === 'nodes') {
          for (const raw of item.ids) {
            markRecord(toEntityId(item.type, raw));
          }
          continue;
        }

        if (item.kind === 'query') {
          markRecord(this.rootRequests.get(item.queryKey));
          continue;
        }

        if (item.kind === 'list') {
          markList(item.listKey);
        }
      }
    }

    while (queue.length > 0) {
      const entityId = queue.shift();
      if (!entityId) {
        continue;
      }

      const record = this.store.read(entityId);
      if (!record) {
        continue;
      }

      this.markRecordReferences(record, markRecord);

      const { type } = parseEntityId(entityId);
      const config = this.types.get(type);
      if (!config?.fields) {
        continue;
      }

      for (const [field, descriptor] of Object.entries(config.fields)) {
        if (!descriptor || descriptor === 'scalar' || !('listOf' in descriptor)) {
          continue;
        }

        for (const [listKey] of this.store.getListsForField(entityId, field)) {
          markList(listKey);
        }
      }
    }

    const swept = this.store.collectGarbage(markedRecords, markedLists, {
      onRecordDeleted: (id) => {
        this.viewDataCache.invalidate(id);
        this.clearStalledRequestsForEntity(id);
      },
    });

    if (swept.records.size > 0) {
      for (const [key, entityId] of this.rootRequests.entries()) {
        if (entityId && swept.records.has(entityId)) {
          this.rootRequests.delete(key);
        }
      }
    }

    if (swept.lists.size > 0) {
      for (const [type, keys] of this.rootLists.entries()) {
        for (const key of swept.lists) {
          keys.delete(key);
        }

        if (keys.size === 0) {
          this.rootLists.delete(type);
        }
      }
    }
  }

  private executeRequestHandle(
    handle: FateRequestPromise<RequestResult<Roots, Request>, RequestDescriptor>,
    mode: RequestMode,
  ) {
    let execution: Promise<RequestResult<Roots, Request>>;
    switch (mode) {
      case 'stale-while-revalidate':
        execution = this.handleStoreAndNetworkRequest(handle.descriptor);
        break;
      case 'cache-first':
      case 'network-only':
      default:
        execution = this.executeRequest(
          handle.descriptor,
          mode === 'network-only' ? { fetchAll: true } : undefined,
        ).then(() => this.getRequestResultFromDescriptor(handle.descriptor));
        break;
    }

    handle.start(execution);
  }

  private markRecordReferences(record: AnyRecord, markRecord: (entityId: EntityId) => void) {
    const seen = new Set<object>();

    const walk = (value: unknown) => {
      if (isNodeRef(value)) {
        markRecord(getNodeRefId(value));
        return;
      }

      if (!value || typeof value !== 'object') {
        return;
      }

      if (seen.has(value)) {
        return;
      }

      seen.add(value);

      if (Array.isArray(value)) {
        for (const item of value) {
          walk(item);
        }
        return;
      }

      for (const child of Object.values(value as AnyRecord)) {
        walk(child);
      }
    };

    walk(record);
  }

  private hasActiveOptimisticUpdates(): boolean {
    return (
      this.optimisticMasks.size > 0 ||
      this.optimisticByEntity.size > 0 ||
      this.pendingOptimisticMutations.size > 0
    );
  }

  private runPendingGarbageCollection() {
    if (this.gcPending && !this.hasActiveOptimisticUpdates()) {
      this.gc();
    }
  }

  private async handleStoreAndNetworkRequest<R extends Request>(
    request: RequestDescriptor,
  ): Promise<RequestResult<Roots, R>> {
    const hasData = this.hasRequestData(request);
    if (!hasData) {
      await this.executeRequest(request, { fetchAll: true });
      return this.getRequestResultFromDescriptor(request) as RequestResult<Roots, R>;
    }

    const result = this.getRequestResultFromDescriptor(request) as RequestResult<Roots, R>;
    this.executeRequest(request, { fetchAll: true }).catch(() => {
      /* empty */
    });
    return result;
  }

  private getRootType(name: string): string {
    const root = this.roots[name];
    if (!root) {
      throw new Error(`fate: Unknown root request '${name}'.`);
    }
    return root.type;
  }

  private createRequestDescriptor(request: Request): RequestDescriptor {
    return createRequestDescriptor(request, (name) => this.getRootType(name));
  }

  private hasRootListData(item: ListRequestDescriptor): boolean {
    const listState = this.store.getListState(item.listKey);
    if (!listState) {
      return false;
    }

    for (const id of listState.ids) {
      if (this.store.missingForSelection(id, item.plan.paths).size > 0) {
        return false;
      }
    }

    return true;
  }

  private async executeRequest(request: RequestDescriptor, options: { fetchAll?: boolean } = {}) {
    const fetchAll = options.fetchAll ?? false;
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
    for (const item of request.items) {
      if (item.kind === 'node' || item.kind === 'nodes') {
        const fields = item.plan.paths;
        const fieldsSignature = [...fields].slice().sort().join(',');
        const argsSignature = [...item.plan.args.entries()]
          .map(([path, entry]) => `${path}:${entry.hash}`)
          .sort()
          .join(',');
        const groupKey = `${item.type}#${fieldsSignature}|${argsSignature}`;
        let group = groups.get(groupKey);
        if (!group) {
          group = { fields, ids: [], plan: item.plan, type: item.type };
          groups.set(groupKey, group);
        }

        for (const raw of item.ids) {
          const entityId = toEntityId(item.type, raw);
          const missing = this.store.missingForSelection(entityId, fields);
          if (fetchAll || missing.size > 0) {
            group.ids.push(raw);
          }
        }
      } else {
        if (item.kind === 'query') {
          const hasResult = this.rootRequests.has(item.queryKey);
          const entityId = this.rootRequests.get(item.queryKey);
          const missing =
            hasResult && entityId
              ? this.store.missingForSelection(entityId, item.plan.paths)
              : item.plan.paths;

          if (fetchAll || !hasResult || (entityId && missing.size > 0)) {
            promises.push(this.fetchQueryAndNormalize(item));
          }
        }

        if (item.kind !== 'list') {
          continue;
        }

        if (
          !fetchAll &&
          !getPaginationArgsInfo(item.argsPayload).hasCursorArg &&
          this.hasRootListData(item)
        ) {
          continue;
        }
        promises.push(this.fetchListAndNormalize(item));
      }
    }

    await Promise.all([
      ...promises,
      ...Array.from(groups.values()).map((group) =>
        group.ids.length
          ? this.fetchByIdAndNormalize(group.type, group.ids, group.fields, group.plan)
          : Promise.resolve(),
      ),
    ]);
  }

  private hasRequestData(request: RequestDescriptor): boolean {
    for (const item of request.items) {
      if (item.kind === 'node' || item.kind === 'nodes') {
        const fields = item.plan.paths;
        for (const raw of item.ids) {
          const entityId = toEntityId(item.type, raw);
          const missing = this.store.missingForSelection(entityId, fields);
          if (missing.size > 0) {
            return false;
          }
        }
        continue;
      }

      if (item.kind === 'query') {
        const hasResult = this.rootRequests.has(item.queryKey);
        const entityId = this.rootRequests.get(item.queryKey);
        const missing =
          hasResult && entityId
            ? this.store.missingForSelection(entityId, item.plan.paths)
            : item.plan.paths;
        if (!hasResult || (entityId && missing.size > 0)) {
          return false;
        }
        continue;
      }

      if (item.kind !== 'list') {
        continue;
      }

      if (!this.hasRootListData(item)) {
        return false;
      }
    }
    return true;
  }

  getRequestResult<R extends Request>(request: R): RequestResult<Roots, R> {
    return this.getRequestResultFromDescriptor(
      this.createRequestDescriptor(request),
    ) as RequestResult<Roots, R>;
  }

  private getRequestResultFromDescriptor(
    request: RequestDescriptor,
  ): RequestResult<Roots, Request> {
    const result: AnyRecord = {};
    for (const item of request.items) {
      if (item.kind === 'node') {
        result[item.name] = createRefWithViewNames(item.type, item.ids[0], item.refViewNames);
        continue;
      }

      if (item.kind === 'nodes') {
        result[item.name] = item.ids.map((id) =>
          createRefWithViewNames(item.type, id, item.refViewNames),
        );
        continue;
      }

      if (item.kind === 'query') {
        const entityId = this.rootRequests.get(item.queryKey);
        if (entityId) {
          const { id } = parseEntityId(entityId);
          result[item.name] = createRefWithViewNames(item.type, id, item.refViewNames);
        } else {
          result[item.name] = null;
        }
        continue;
      }

      if (item.kind !== 'list') {
        continue;
      }

      const listState = this.store.getListState(item.listKey);
      const entries = getListEntries(listState);
      const nodes = entries.map(({ id }) => rootListRefWithViewNames(id, item.nodeRefViewNames));

      if (item.hasItems) {
        const connection: AnyRecord = {
          items: nodes.map((node, index) => ({ cursor: entries[index]?.cursor, node })),
          pagination: listState?.pagination,
        };

        const metadata: ConnectionMetadata = {
          args: item.argsPayload,
          field: item.name,
          key: item.listKey,
          owner: item.name,
          procedure: `request.${item.name}`,
          root: true,
          type: item.type,
        };

        Object.defineProperty(connection, ConnectionTag, {
          configurable: false,
          enumerable: false,
          value: metadata,
          writable: false,
        });

        result[item.name] = connection;
        continue;
      }

      result[item.name] = nodes;
    }
    return result as RequestResult<Roots, Request>;
  }

  private async fetchByIdAndNormalize(
    type: string,
    ids: Array<string | number>,
    select: Set<string>,
    plan?: SelectionPlan,
    prefix: string | null = null,
  ) {
    const resolvedArgs = resolvedArgsFromPlan(plan);
    const records = await this.transport.fetchById(type, ids, select, resolvedArgs);
    for (const record of records) {
      this.writeEntity(type, record as AnyRecord, select, undefined, plan, prefix);
    }
  }

  private async fetchQueryAndNormalize(item: QueryRequestDescriptor) {
    if (!this.transport.fetchQuery) {
      throw new Error(
        `fate: transport does not support queries. Please add support for 'fetchQuery' in your transport for '${item.name}'.`,
      );
    }

    const record = await this.transport.fetchQuery(item.name, item.plan.paths, item.argsPayload);
    if (!record || typeof record !== 'object') {
      this.rootRequests.set(item.queryKey, null);
      return;
    }

    const entityId = this.writeEntity(
      item.type,
      record as AnyRecord,
      item.plan.paths,
      undefined,
      item.plan,
    );
    this.rootRequests.set(item.queryKey, entityId);
  }

  private async fetchListAndNormalize(item: ListRequestDescriptor) {
    if (!this.transport.fetchList) {
      throw new Error(
        `fate: 'transport.fetchList' is not configured but request includes a list for key '${item.name}'.`,
      );
    }

    const { items, pagination } = await this.transport.fetchList(
      item.name,
      item.plan.paths,
      item.argsPayload,
    );
    const ids: Array<EntityId> = [];
    const cursors: Array<string | undefined> = [];
    for (const entry of items) {
      const id = this.writeEntity(
        item.type,
        entry.node as AnyRecord,
        item.plan.paths,
        undefined,
        item.plan,
      );
      ids.push(id);
      cursors.push(entry.cursor);
    }
    if (!item.argsPayload) {
      this.registerRootList(item.type, item.listKey);
    }

    const previous = this.store.getListState(item.listKey);
    this.store.setList(
      item.listKey,
      this.mergeListState(
        previous,
        ids,
        cursors,
        pagination,
        getPaginationArgsInfo(item.argsPayload),
      ),
    );
  }

  private writeEntity(
    type: string,
    record: AnyRecord,
    select: ReadonlySet<string>,
    snapshots?: Map<EntityId, Snapshot>,
    plan?: SelectionPlan,
    pathPrefix: string | null = null,
    blockedMask?: FieldMask | null,
    insert?: InsertPosition,
    listSnapshots?: Map<string, List>,
  ): EntityId {
    const config = this.types.get(type);
    if (!config) {
      throw new Error(`fate: Found unknown entity type '${type}' in normalization.`);
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
        const isFieldBlocked = blockedMask ? isCovered(blockedMask, fieldPath) : false;
        if (relationDescriptor === 'scalar') {
          if (isFieldBlocked) {
            continue;
          }
          result[key] = value;
        } else if (
          relationDescriptor &&
          typeof relationDescriptor === 'object' &&
          'type' in relationDescriptor
        ) {
          if (isFieldBlocked) {
            continue;
          }
          const childPaths = selectionTree.get(key) ?? emptySet;
          if (value === null) {
            result[key] = null;
            continue;
          }
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

            this.writeEntity(
              childType,
              value as AnyRecord,
              childPaths,
              snapshots,
              plan,
              fieldPath,
              blockedMask,
              undefined,
              listSnapshots,
            );
          }
        } else if (
          relationDescriptor &&
          typeof relationDescriptor === 'object' &&
          'listOf' in relationDescriptor
        ) {
          if (isFieldBlocked) {
            continue;
          }
          const childPaths = selectionTree.get(key) ?? emptySet;
          if (value === null) {
            result[key] = null;
            continue;
          }
          const childType = relationDescriptor.listOf;
          const childConfig = this.types.get(childType);
          if (!childConfig) {
            throw new Error(`fate: Unknown related type '${childType}' (field '${type}.${key}').`);
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
            const ids: Array<EntityId> = [];
            const cursors: Array<string | undefined> = [];

            const nodeSelection = childPaths.size > 0 ? new Set<string>() : childPaths;

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
              const cursor = 'cursor' in entry ? (entry.cursor as string) : undefined;
              cursors.push(cursor);
              if (isNodeRef(node)) {
                ids.push(getNodeRefId(node));
                continue;
              }

              if (node && typeof node === 'object') {
                const childId = toEntityId(childType, childConfig.getId(node as AnyRecord));

                this.writeEntity(
                  childType,
                  node as AnyRecord,
                  nodeSelection,
                  snapshots,
                  plan,
                  fieldPath,
                  blockedMask,
                  undefined,
                  listSnapshots,
                );

                ids.push(childId);
                continue;
              }

              continue;
            }

            const listKey = getListKey(entityId, key, fieldArgs?.hash);
            const previousList = this.store.getListState(listKey);
            const argsValue = fieldArgs?.value as AnyRecord | undefined;

            const nextListState = this.mergeListState(
              previousList,
              ids,
              cursors,
              connection.pagination as List['pagination'],
              getPaginationArgsInfo(argsValue),
            );

            result[key] = nextListState.ids.map((id) => createNodeRef(id));

            this.store.setList(listKey, nextListState);
          }
        } else {
          result[key] = value;
        }
      }
    }

    for (const [key, value] of Object.entries(record)) {
      if (!(key in (config.fields ?? {}))) {
        const fieldPath = pathPrefix ? `${pathPrefix}.${key}` : key;
        if (blockedMask && isCovered(blockedMask, fieldPath)) {
          continue;
        }
        result[key] = value;
      }
    }

    if (snapshots && !snapshots.has(entityId)) {
      snapshots.set(entityId, this.store.snapshot(entityId));
    }

    this.viewDataCache.invalidate(entityId);
    this.store.merge(entityId, result, select);
    this.linkParentLists(type, entityId, result, snapshots, listSnapshots, insert ?? 'after');
    if (!pathPrefix && insert) {
      this.insertIntoRootLists(type, entityId, insert, listSnapshots);
    }
    return entityId;
  }

  private linkParentLists(
    type: string,
    entityId: EntityId,
    record: AnyRecord,
    snapshots: Map<EntityId, Snapshot> | undefined,
    listSnapshots: Map<string, List> | undefined,
    insert: InsertPosition,
  ) {
    if (insert === 'none') {
      return;
    }

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

      if (current.some((item) => isNodeRef(item) && getNodeRefId(item) === entityId)) {
        continue;
      }

      if (snapshots && !snapshots.has(parentId)) {
        snapshots.set(parentId, this.store.snapshot(parentId));
      }

      this.viewDataCache.invalidate(parentId);

      const defaultListKey = getListKey(parentId, parent.field);
      const defaultListState = this.store.getListState(defaultListKey);
      let nextField = current;
      if (defaultListState) {
        const { list: nextDefaultListState, pending } = this.applyListInsert(
          defaultListState,
          entityId,
          insert,
        );
        if (nextDefaultListState !== defaultListState) {
          this.snapshotList(defaultListKey, listSnapshots);
          this.store.setList(defaultListKey, nextDefaultListState);
        }

        const nextFieldIds = pending
          ? getListEntries(nextDefaultListState).map(({ id }) => id)
          : nextDefaultListState.ids;
        nextField = nextFieldIds.map((id) => createNodeRef(id));
      } else {
        const currentIds = current
          .map((item) => (isNodeRef(item) ? getNodeRefId(item) : null))
          .filter((id): id is EntityId => id != null);
        const ids = insert === 'before' ? [entityId, ...currentIds] : [...currentIds, entityId];
        const nextDefaultListState = { ids } satisfies List;
        this.snapshotList(defaultListKey, listSnapshots);
        this.store.setList(defaultListKey, nextDefaultListState);
        nextField = nextDefaultListState.ids.map((id) => createNodeRef(id));
      }

      const registeredLists = this.store
        .getListsForField(parentId, parent.field)
        .filter(([key]) => key !== defaultListKey);

      for (const [listKey, listState] of registeredLists) {
        const nextListState = this.applyListInsert(listState, entityId, insert).list;
        if (nextListState === listState) {
          continue;
        }

        this.snapshotList(listKey, listSnapshots);
        this.store.setList(listKey, nextListState);
      }

      this.store.merge(parentId, { [parent.field]: nextField }, [parent.field]);
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

    const coverageById = new Map<EntityId, Set<string>>();

    const walk = (
      viewPayload: object,
      record: AnyRecord,
      target: ViewResult,
      parentId: EntityId,
      prefix: string | null,
    ) => {
      for (const [key, selectionKind] of Object.entries(viewPayload)) {
        if (isViewTag(key)) {
          if (!target[ViewsTag]) {
            assignViewTag(target, new Set());
          }

          target[ViewsTag]!.add(key);
          continue;
        }

        coverageById.set(parentId, (coverageById.get(parentId) ?? new Set()).add(key));

        const fieldPath = prefix ? `${prefix}.${key}` : key;
        const selectionType = typeof selectionKind;
        if (selectionType === 'boolean' && selectionKind) {
          target[key] = record[key];
        } else if (selectionKind && selectionType === 'object') {
          const selectionValue = selectionKind as AnyRecord;
          const { args: selectionArgs, ...selectionWithoutArgs } = selectionValue;
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

          if (value == null) {
            target[key] = null;
            continue;
          }

          if (Array.isArray(value)) {
            if (nextSelection.items && typeof nextSelection.items === 'object') {
              const selection = nextSelection.items as AnyRecord;
              const fieldArgs = plan.args.get(fieldPath);
              const listKey = getListKey(parentId, key, fieldArgs?.hash);
              const listState = this.store.getListState(listKey);
              const entries = listState
                ? getListEntries(listState)
                : value.map((item) => ({
                    cursor: undefined,
                    id: isNodeRef(item) ? getNodeRefId(item) : (null as EntityId | null),
                  }));
              const items = entries.map((entry, index) => {
                const entityId = entry.id;

                if (!entityId) {
                  const itemResult: AnyRecord = {
                    cursor: listState?.cursors?.[index],
                    node: null,
                  };
                  return itemResult;
                }

                ids.add(entityId);
                const record = this.store.read(entityId);
                const { id, type } = parseEntityId(entityId);
                const node = { __typename: type, id };

                if (record) {
                  walk(selection.node as AnyRecord, record, node, entityId, fieldPath);
                }

                const itemResult: AnyRecord = {
                  node: record ? node : null,
                };

                if (selection.cursor === true) {
                  itemResult.cursor = entry.cursor;
                }
                return itemResult;
              });
              const connection: AnyRecord = { items };
              if ('pagination' in nextSelection && nextSelection.pagination) {
                const paginationSelection = nextSelection.pagination as AnyRecord;
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
                      pagination.previousCursor = storedPagination.previousCursor;
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
              const { id: ownerRawId, type: parentType } = parseEntityId(parentId);
              const childType = (() => {
                for (const item of value) {
                  if (isNodeRef(item)) {
                    return parseEntityId(getNodeRefId(item)).type;
                  }
                }
                return '';
              })();
              if (parentType) {
                const metadataArgs = (() => {
                  if (!fieldArgs?.value && ownerRawId === undefined) {
                    return undefined;
                  }
                  const value = fieldArgs?.value ? { ...fieldArgs.value } : ({} as AnyRecord);
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
                  root: false,
                  type: childType,
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
              walk(nextSelection, relatedRecord, targetRecord as ViewResult, entityId, fieldPath);
            }
          } else {
            walk(nextSelection, value as AnyRecord, target[key] as ViewResult, entityId, fieldPath);
          }
        }
      }
    };

    const data: ViewResult = {
      __typename: parseEntityId(entityId).type,
    };

    for (const viewPayload of getViewPayloads(viewComposition, ref)) {
      walk(viewPayload.select, record, data, entityId, pathPrefix);
    }

    return {
      coverage: [...coverageById.entries()],
      data: data as ViewData<T, S>,
    };
  }

  private clearStalledRequestsForEntity(entityId: EntityId) {
    const prefix = this.pendingPrefix(entityId);

    for (const key of this.stalledRequests) {
      if (key.startsWith(prefix)) {
        this.stalledRequests.delete(key);
      }
    }
  }

  private pendingPrefix(entityId: string) {
    return `__fate__|${entityId}|`;
  }

  private pendingKey(entityId: string, missingFields: Set<string>) {
    return `${this.pendingPrefix(entityId)}${[...missingFields].sort().join('|')}`;
  }
}

export function createClient<
  T extends [FateRoots, FateMutations] = [
    Record<never, RootDefinition<any, any>>,
    Record<never, MutationDefinition<any, any, any>>,
  ],
>(options: FateClientOptions<T[0], T[1]>) {
  return new FateClient<T[0], T[1]>(options);
}
