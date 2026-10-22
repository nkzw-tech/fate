import { withAliasSupport } from './alias-transport.ts';
import { aliasedField, isAliasedSelection, isAliasedView, schemaField } from './alias.ts';
import {
  combineArgsPayload,
  filterConnectionArgs,
  hashArgs,
  resolvedArgsFromPlan,
  scopeArgsPayload,
} from './args.ts';
import ViewDataCache from './cache.ts';
import {
  createDeferred,
  getDeferredMetadata,
  getDeferredSelection,
  isDeferred,
  isDeferredSelection,
} from './defer.ts';
import { argumentFieldKey, getFieldKey, getStoragePath } from './field-key.ts';
import {
  decodeClientHydrationState,
  encodeHydrationValue,
  resolveHydrationLimits,
  type ClientHydrationState,
  type FateDehydratedState,
  type HydrationLimits,
  type HydrateOptions,
} from './hydration.ts';
import { getListEntries } from './list.ts';
import {
  FateMutations,
  InsertPosition,
  MutationActionsFor,
  MutationFunction,
  MutationFunctionsFor,
  type MutationInsertion,
  type ResolvedInsertion,
  type ResolvedMutationInsertion,
  type MutationCommand,
  wrapAction,
  wrapMutation,
} from './mutation.ts';
import { createNodeRef, getNodeRefId, isNodeRef } from './node-ref.ts';
import OperationLifetime, { type RetainHandle } from './operation-lifetime.ts';
import type {
  MutationIdentity,
  Persistence,
  PersistenceRuntime,
  PersistenceSession,
  RequestPersistenceOptions,
} from './persistence-types.ts';
import { FateRequestError, type FateLiveConnectionEvent } from './protocol.ts';
import { abortable, readControl, SharedReads, validateTimeout } from './read-control.ts';
import { isRecord } from './record.ts';
import {
  assignViewTag,
  createRefWithViewNames,
  getRootViewNames,
  parseEntityId,
  toEntityId,
} from './ref.ts';
import { expandRefetchSelection, getRefetchFields, resolveRefetchArgs } from './refetch.ts';
import RenderReadErrors from './render-read-errors.ts';
import {
  createRequestDescriptor,
  getPaginationArgsInfo,
  resolveSelectionPlan,
  type ListRequestDescriptor,
  type QueryRequestDescriptor,
  type ValueRequestDescriptor,
  type RequestDescriptor,
  type RequestItemDescriptor,
} from './request-descriptor.ts';
import {
  createRequestObserver,
  type RequestObserver,
  type RequestStateOptions,
} from './request-observer.ts';
import FateRequestPromise from './request-promise.ts';
import { getDeferredSelectionPlan, getSelectionPlan, type SelectionPlan } from './selection.ts';
import { getListKey, List, mergePreservingExisting, parseListKey, Store } from './store.ts';
import { Transport } from './transport.ts';
import {
  ConnectionMetadata,
  ConnectionTag,
  isViewTag,
  ViewResult,
  ViewsTag,
  ViewPayload,
  type AnyRecord,
  type CheckedRequest,
  type Deferred,
  type Entity,
  type EntityId,
  type FateThenable,
  type MutationMapFromDefinitions,
  type Pagination,
  type Request,
  type RequestResult,
  type Selection,
  type TypeConfig,
  type View,
  type ViewData,
  type ViewRef,
  type ViewSnapshot,
  FateRoots,
  MutationDefinition,
  RootDefinition,
} from './types.ts';
import { addViewName, getViewNames, getViewPayloads, resolveView } from './view.ts';
import { resolveConditionalSelection } from './when.ts';

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
export type RequestOptions = Readonly<{
  mode?: RequestMode;
  /** Override disk retention in milliseconds; only used with persistence. */
  persist?: RequestPersistenceOptions;
  /** Cancel this reader without cancelling other readers of shared work. */
  signal?: AbortSignal;
  /** Maximum read duration in milliseconds, including persistence initialization. Opt-in. */
  timeout?: number;
}>;

export type DeferredSnapshot<T> = Readonly<{
  coverage: ReadonlyArray<readonly [id: EntityId, paths: ReadonlySet<string>]>;
  data: T;
}>;

type EntityFetchResult = Readonly<{ generation: number; record: unknown }>;

type FateClientOptions<
  Roots extends FateRoots,
  Mutations extends FateMutations,
  HydrationScope extends string,
> = {
  /**
   * Number of recently released requests to keep retained before their records
   * and lists are eligible for garbage collection.
   *
   * @defaultValue 10
   */
  gcReleaseBufferSize?: number;
  /**
   * Bounds hydration snapshot encoding and decoding work.
   */
  hydrationLimits?: Partial<HydrationLimits>;
  /**
   * Identifies snapshots compatible with this client. Change this value when
   * deploying an incompatible cache schema or separating cache namespaces.
   */
  hydrationScope?: HydrationScope;
  mutations?: Mutations;
  onLiveError?: (error: unknown) => void;
  persistence?: Persistence;
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
const emptyDispose = () => undefined;
const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const getDefaultHydrationScope = (
  roots: FateRoots | undefined,
  types: ReadonlyArray<Omit<TypeConfig, 'getId'> & Partial<{ getId: TypeConfig['getId'] }>>,
) =>
  JSON.stringify({
    roots: Object.entries(roots ?? {})
      .map(([name, root]) => [name, root.type])
      .sort(([left], [right]) => compareStrings(left, right)),
    types: types
      .map(({ fields, possibleTypes, type }) => ({
        fields: Object.entries(fields ?? {})
          .map(([field, descriptor]) => [field, descriptor] as const)
          .sort(([left], [right]) => compareStrings(left, right)),
        possibleTypes,
        type,
      }))
      .sort((left, right) => compareStrings(left.type, right.type)),
  });

const dropCanonicalListIds = (
  listIds: ReadonlyArray<EntityId> | undefined,
  ids: ReadonlyArray<EntityId>,
) => {
  if (!listIds || listIds.length === 0) {
    return undefined;
  }

  const canonicalIds = new Set(ids);
  const next = listIds.filter((id) => !canonicalIds.has(id));
  return next.length > 0 ? next : undefined;
};

const removeListId = (
  listIds: ReadonlyArray<EntityId> | undefined,
  entityId: EntityId,
): ReadonlyArray<EntityId> | undefined =>
  listIds?.includes(entityId) ? listIds.filter((id) => id !== entityId) : listIds;

const areArraysEqual = <T>(
  left: ReadonlyArray<T> | undefined,
  right: ReadonlyArray<T> | undefined,
) => {
  if (left === right) {
    return true;
  }

  if (!left || !right || left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
};

const arePaginationStatesEqual = (left: Pagination | undefined, right: Pagination | undefined) =>
  left === right ||
  (!left || !right
    ? false
    : left.hasNext === right.hasNext &&
      left.hasPrevious === right.hasPrevious &&
      left.nextCursor === right.nextCursor &&
      left.previousCursor === right.previousCursor);

const areListStatesEqual = (left: List | undefined, right: List) =>
  Boolean(left) &&
  areArraysEqual(left?.ids, right.ids) &&
  areArraysEqual(left?.cursors, right.cursors) &&
  areArraysEqual(left?.liveAfterIds, right.liveAfterIds) &&
  areArraysEqual(left?.liveBeforeIds, right.liveBeforeIds) &&
  areArraysEqual(left?.pendingAfterIds, right.pendingAfterIds) &&
  areArraysEqual(left?.pendingBeforeIds, right.pendingBeforeIds) &&
  left?.backwardPageLimit === right.backwardPageLimit &&
  left?.forwardPageLimit === right.forwardPageLimit &&
  left?.unloaded === right.unloaded &&
  arePaginationStatesEqual(left?.pagination, right.pagination);

const createNodeRefsForIds = (
  ids: ReadonlyArray<EntityId>,
  current: unknown,
  options: { reuseCurrentArray?: boolean } = {},
): Array<ReturnType<typeof createNodeRef>> => {
  if (
    options.reuseCurrentArray !== false &&
    Array.isArray(current) &&
    current.length === ids.length
  ) {
    let matches = true;
    for (let index = 0; index < ids.length; index += 1) {
      const value = current[index];
      if (!isNodeRef(value) || getNodeRefId(value) !== ids[index]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return current as Array<ReturnType<typeof createNodeRef>>;
    }
  }

  const existingRefsById = new Map<EntityId, ReturnType<typeof createNodeRef>>();
  if (Array.isArray(current)) {
    for (const value of current) {
      if (isNodeRef(value)) {
        existingRefsById.set(getNodeRefId(value), value);
      }
    }
  }

  return ids.map((id) => existingRefsById.get(id) ?? createNodeRef(id));
};

const getConnectionPageLimit = (args: AnyRecord | undefined, direction: 'forward' | 'backward') => {
  const value = direction === 'forward' ? (args?.first ?? args?.last) : (args?.last ?? args?.first);
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
};

const isConnectionWindowFull = (
  listState: List,
  connection: ConnectionMetadata,
  direction: 'forward' | 'backward',
) => {
  const limit = getConnectionPageLimit(connection.args, direction);
  return limit != null && listState.ids.length >= limit;
};

const hasConnectionPageCoverage = (
  listState: List,
  args: AnyRecord | undefined,
  direction: 'forward' | 'backward',
) => {
  if (listState.unloaded) {
    return false;
  }
  const limit = getConnectionPageLimit(args, direction);
  const pagination = listState.pagination;

  if (direction === 'forward') {
    if (pagination?.hasPrevious) {
      return false;
    }

    return (
      limit == null ||
      listState.ids.length >= limit ||
      (listState.forwardPageLimit != null && listState.forwardPageLimit >= limit) ||
      pagination?.hasNext === false
    );
  }

  if (pagination?.hasNext) {
    return false;
  }

  return (
    limit == null ||
    listState.ids.length >= limit ||
    (listState.backwardPageLimit != null && listState.backwardPageLimit >= limit) ||
    pagination?.hasPrevious === false
  );
};

const getPaginationMergeInfo = (args: AnyRecord | undefined) => {
  const paginationArgs = getPaginationArgsInfo(args);
  return {
    ...paginationArgs,
    pageLimit: getConnectionPageLimit(args, paginationArgs.direction),
  };
};

const getConnectionBoundaryCursor = (
  listState: List,
  direction: 'forward' | 'backward',
): string | undefined => {
  if (!listState.cursors || listState.cursors.length === 0) {
    return undefined;
  }

  return direction === 'forward' ? listState.cursors.at(-1) : listState.cursors[0];
};

const markConnectionPageAvailable = (listState: List, direction: 'forward' | 'backward'): List => {
  const pagination = {
    hasNext: Boolean(listState.pagination?.hasNext),
    hasPrevious: Boolean(listState.pagination?.hasPrevious),
    nextCursor: listState.pagination?.nextCursor,
    previousCursor: listState.pagination?.previousCursor,
  };
  const cursor = getConnectionBoundaryCursor(listState, direction);

  if (direction === 'forward') {
    pagination.hasNext = true;
    pagination.nextCursor = cursor ?? pagination.nextCursor;
  } else {
    pagination.hasPrevious = true;
    pagination.previousCursor = cursor ?? pagination.previousCursor;
  }

  return {
    ...listState,
    pagination,
  };
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

const reuseNormalizedField = (value: unknown, previous: unknown): unknown => {
  if (
    Object.is(value, previous) ||
    (isNodeRef(value) && isNodeRef(previous) && getNodeRefId(value) === getNodeRefId(previous)) ||
    (Array.isArray(value) &&
      Array.isArray(previous) &&
      value.length === previous.length &&
      value.every((item, index) => Object.is(item, previous[index])))
  ) {
    return previous;
  }
  return value;
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

type NormalizationSelection = {
  children: ReadonlyMap<string, Set<string>>;
  paths: ReadonlySet<string>;
  storagePaths: Map<
    string,
    Array<{ path: string; recordKey: string; storageKey: string; storagePath: string }>
  >;
};
type NormalizationSelections = Map<ReadonlySet<string>, Map<string, NormalizationSelection>>;

/**
 * Core client that normalizes records, manages the view cache, and coordinates
 * data fetching.
 */
export class FateClient<
  Roots extends FateRoots,
  Mutations extends FateMutations,
  HydrationScope extends string = string,
> {
  private writeGeneration = 0;
  private mutationWrite: { fields?: ReadonlySet<string> } | undefined;
  private applyingGeneration: number | undefined;
  private applyingPaginationList: string | undefined;
  private readonly writeVersions = new Map<string, number>();

  private acceptWrite(key: string, generation: number): boolean {
    if (this.store.isRecordingOptimistic) {
      return true;
    }
    if ((this.writeVersions.get(key) ?? 0) > generation) {
      return false;
    }
    this.writeVersions.set(key, generation);
    if (key.startsWith('list:') && key !== `list:${this.applyingPaginationList}`) {
      this.writeVersions.set(`refresh:${key}`, generation);
    }
    return true;
  }

  private withWriteGeneration<T>(generation: number, apply: () => T): T {
    const previous = this.applyingGeneration;
    this.applyingGeneration = generation;
    try {
      return apply();
    } finally {
      this.applyingGeneration = previous;
    }
  }

  private withPaginationWrite<T>(key: string, generation: number, apply: () => T): T {
    const previous = this.applyingPaginationList;
    this.applyingPaginationList = key;
    try {
      return this.withWriteGeneration(generation, apply);
    } finally {
      this.applyingPaginationList = previous;
    }
  }

  private relatedEntityType(
    declaredType: string,
    possibleTypes: ReadonlyArray<string> | undefined,
    record: AnyRecord,
  ): string {
    if (!possibleTypes) {
      return declaredType;
    }
    const actualType = record.__typename;
    if (typeof actualType !== 'string' || !possibleTypes.includes(actualType)) {
      throw new Error(
        `fate: Expected '${declaredType}' relation to contain one of ${possibleTypes.join(', ')}, received '${String(actualType)}'.`,
      );
    }
    return actualType;
  }

  private readonly requestListeners = new Map<
    () => void,
    { dependencies: Set<string>; descriptor: RequestDescriptor }
  >();
  private readonly requestListenersByDependency = new Map<string, Set<() => void>>();
  private readonly pendingRequestListeners = new Set<() => void>();
  private requestNotificationScheduled = false;
  private readonly cacheOnlyRefs = new WeakSet<object>();
  private readonly cacheOnlyCopies = new WeakMap<object, object>();
  private readonly requestResults = new WeakMap<RequestDescriptor, AnyRecord>();
  private readonly requestItemResults = new WeakMap<
    RequestItemDescriptor,
    { source: unknown; value: unknown }
  >();
  private readonly mutationEntities?: ReadonlyMap<string, string>;
  private readonly mutationMap: Record<string, MutationFunction<any>>;
  private readonly parentLists = new Map<
    string,
    Array<{ field: string; parentType: string; via?: string }>
  >();
  private readonly rootLists = new Map<string, Set<string>>();
  private readonly listTargets = new WeakMap<object, ConnectionMetadata>();
  private readonly deferredTargets = new WeakSet<object>();
  private readonly mutationLists = new Map<string, { count: number; list: ConnectionMetadata }>();
  private readonly pending = new Map<string, PromiseLike<ViewSnapshot<any, any>>>();
  private readonly connectionRequests = new Map<string, Promise<List | undefined>>();
  private readonly pendingDeferred = new Map<string, PromiseLike<DeferredSnapshot<any>>>();
  private readonly pendingOptimisticMutations = new Map<EntityId, Set<Promise<unknown>>>();
  private readonly optimisticEntityResolutions = new Map<EntityId, EntityId>();
  private readonly onLiveError: ((error: unknown) => void) | undefined;
  private readonly liveSubscriptions = new Map<
    string,
    { count: number; releaseScheduled?: boolean; unsubscribe: () => void }
  >();
  private readonly liveConnectionInvalidations = new Map<string, number>();
  private readonly stableRefs = new Map<EntityId, Map<string, ViewRef<string>>>();
  private readonly requests = new Map<
    string,
    Map<RequestMode, FateRequestPromise<RequestResult<Roots, Request>, RequestDescriptor>>
  >();
  private readonly requestExecutionOptions = new WeakMap<
    RequestDescriptor,
    { fetchAll: boolean; persist?: { maxAge: number } }
  >();
  private readonly rootRequests = new Map<string, EntityId | null>();
  private readonly rootValues = new Map<string, unknown>();
  private readonly stalledRequests = new Set<string>();
  private readonly renderReadErrors = new RenderReadErrors();
  private gcPending = false;
  private gcScheduled = false;
  private pendingNetworkRequests = 0;
  private readonly persistenceDisposal?: AbortController;
  private readonly persistenceRuntime?: PersistenceRuntime;
  readonly store = new Store(
    (ids, lists) => {
      for (const id of ids) {
        this.viewDataCache.invalidate(id);
      }
      this.runPendingGarbageCollection();
      this.notifyRequests([
        ...[...ids].map((id) => `entity:${id}`),
        ...[...lists].map((key) => `list:${key}`),
        ...[...ids].flatMap((id) =>
          this.store.getListKeysForEntity(id).map((key) => `list:${key}`),
        ),
      ]);
    },
    (change) => {
      if (!this.store.isRecordingOptimistic) {
        const generation = this.applyingGeneration ?? ++this.writeGeneration;
        if (change.kind === 'record') {
          if (change.paths) {
            for (const path of change.paths) {
              this.acceptWrite(JSON.stringify([change.key, path.split('.')[0]]), generation);
            }
          } else {
            this.acceptWrite(JSON.stringify([change.key]), generation);
          }
        } else {
          this.acceptWrite(`list:${change.key}`, generation);
        }
      }
      if (change.kind === 'record') {
        this.viewDataCache.invalidate(change.key);
      } else {
        const owner = parseListKey(change.key);
        if (owner) {
          this.viewDataCache.invalidate(owner.ownerId);
        }
      }
      this.persistenceRuntime?.changed(change);
      this.notifyRequests(
        change.kind === 'record'
          ? [
              `entity:${change.key}`,
              ...this.store.getListKeysForEntity(change.key).map((key) => `list:${key}`),
            ]
          : [`list:${change.key}`],
      );
    },
  );
  private readonly operationLifetime: OperationLifetime;
  private readonly hydrationLimits: HydrationLimits;
  private readonly hydrationScope: HydrationScope;
  private readonly types: ReadonlyMap<string, TypeConfig>;
  private readonly transport: Transport<MutationMapFromDefinitions<Mutations>>;
  // Intermediate rollback/replay states must not evict or populate view snapshots.
  private readonly viewDataCache = new ViewDataCache(() => !this.store.isRebasing);
  private liveConnectionInvalidationToken = 0;

  readonly persistence?: PersistenceSession;
  readonly actions: MutationActionsFor<Mutations>;
  readonly mutations: MutationFunctionsFor<Mutations>;
  readonly roots: Roots;

  constructor(options: FateClientOptions<Roots, Mutations, HydrationScope>) {
    this.persistenceDisposal = options.persistence ? new AbortController() : undefined;
    this.actions = Object.create(null) as MutationActionsFor<Mutations>;
    this.mutationMap = Object.create(null);
    if (options.persistence || options.types.some((config) => config.refetch)) {
      this.mutationEntities = new Map(
        Object.entries(options.mutations ?? {}).map(([key, definition]) => [
          key,
          definition.entity,
        ]),
      );
    }
    this.mutations = Object.create(null) as MutationFunctionsFor<Mutations>;
    this.onLiveError = options.onLiveError;
    this.operationLifetime = new OperationLifetime(options.gcReleaseBufferSize ?? 10);
    this.hydrationLimits = resolveHydrationLimits(options.hydrationLimits);
    const hydrationScope =
      options.hydrationScope ?? getDefaultHydrationScope(options.roots, options.types);
    if (typeof hydrationScope !== 'string' || hydrationScope.length === 0) {
      throw new Error(`fate: Hydration scope must be a non-empty string.`);
    }
    this.hydrationScope = hydrationScope as HydrationScope;
    this.roots = options.roots;
    this.transport = withAliasSupport(options.transport);
    this.types = new Map(options.types.map((entity) => [entity.type, { getId, ...entity }]));

    for (const config of this.types.values()) {
      if (config.refetch) {
        for (const field of getRefetchFields(config.refetch)) {
          const descriptor = config.fields?.[field];
          if (descriptor && descriptor !== 'scalar') {
            throw new Error(
              `fate: Refetch locator '${config.type}.${field}' must be a scalar field.`,
            );
          }
        }
        if (!this.transport.fetchQuery) {
          throw new Error(`fate: Refetching '${config.type}' requires transport.fetchQuery.`);
        }
      }
    }

    if (options.mutations) {
      for (const [key, definition] of Object.entries(options.mutations)) {
        const mutation = wrapMutation(this, { ...definition, key });
        this.mutationMap[key] = mutation;

        setNestedValue(this.mutations as AnyRecord, key, mutation);

        setNestedValue(this.actions as AnyRecord, key, wrapAction(mutation));
      }
    }

    this.initializeParentLists();
    this.persistenceRuntime = options.persistence?.attach(this);
    this.persistence = this.persistenceRuntime;
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

  /**
   * Exports the durable normalized cache as an opaque JSON-safe value for SSR
   * transfer or persistence. Runtime requests, subscriptions, retainers, and
   * optimistic state are intentionally excluded.
   */
  dehydrate(): FateDehydratedState<HydrationScope> {
    if (this.hasActiveOptimisticUpdates()) {
      throw new Error(`fate: Cannot dehydrate while optimistic updates are active.`);
    }
    if (this.hasPendingRequests()) {
      throw new Error(`fate: Cannot dehydrate while requests are pending.`);
    }

    return {
      data: encodeHydrationValue(
        {
          rootLists: [...this.rootLists].map(([type, keys]) => [type, [...keys]]),
          rootRequests: [...this.rootRequests],
          rootValues: [...this.rootValues],
          store: this.store.dehydrate(),
        },
        this.hydrationLimits,
      ),
      scope: this.hydrationScope,
      version: 1,
    };
  }

  /**
   * Restores a durable normalized cache snapshot without restoring runtime
   * request handles, retainers, subscriptions, or optimistic update state.
   * Hydrate before rendering SSR content. Replaying the same snapshot is safe.
   */
  hydrate(state: FateDehydratedState<HydrationScope>, options: HydrateOptions = {}): void {
    if (!state || typeof state !== 'object' || state.version !== 1) {
      throw new Error(`fate: Unsupported hydration state version.`);
    }
    if (state.scope !== this.hydrationScope) {
      throw new Error(`fate: Hydration state scope does not match this client.`);
    }

    if (this.hasActiveOptimisticUpdates()) {
      throw new Error(`fate: Cannot hydrate while optimistic updates are active.`);
    }
    if (this.hasPendingRequests()) {
      throw new Error(`fate: Cannot hydrate while requests are pending.`);
    }

    const mode = options.merge ?? 'preserve-existing';
    if (mode !== 'preserve-existing' && mode !== 'replace') {
      throw new Error(`fate: Unsupported hydration merge mode.`);
    }
    const decoded = decodeClientHydrationState(state.data, this.hydrationLimits);

    const notify = this.store.hydrate(decoded.store, mode, { deferNotifications: true });

    if (mode === 'replace') {
      this.rootLists.clear();
      this.rootRequests.clear();
      this.rootValues.clear();
      this.stableRefs.clear();
    }

    for (const [type, incomingKeys] of decoded.rootLists) {
      let keys = this.rootLists.get(type);
      if (!keys) {
        keys = new Set();
        this.rootLists.set(type, keys);
      }
      for (const key of incomingKeys) {
        keys.add(key);
      }
    }

    for (const [key, entityId] of decoded.rootRequests) {
      if (mode === 'replace' || !this.rootRequests.has(key)) {
        this.rootRequests.set(key, entityId);
      }
    }

    for (const [key, value] of decoded.rootValues ?? []) {
      if (mode === 'replace' || !this.rootValues.has(key)) {
        this.rootValues.set(key, value);
      }
    }

    this.stalledRequests.clear();
    this.viewDataCache.clear();
    notify();
  }

  /** @internal */
  exportPersistenceState(): FateDehydratedState<HydrationScope> {
    return {
      data: encodeHydrationValue(
        {
          rootLists: [...this.rootLists].map(([type, keys]) => [type, [...keys]]),
          rootRequests: [...this.rootRequests],
          rootValues: [...this.rootValues],
          store: this.store.dehydrateConfirmed(),
        },
        this.hydrationLimits,
      ),
      scope: this.hydrationScope,
      version: 1,
    };
  }

  /** @internal */
  retainPersistenceRequest(request: RequestDescriptor) {
    return this.operationLifetime.retain(request, () => this.scheduleGarbageCollection());
  }

  /** @internal */
  getPersistenceScope() {
    return this.hydrationScope;
  }

  /** @internal */
  getPersistenceRootLists(type: string) {
    return this.rootLists.get(type) ?? new Set<string>();
  }

  /** @internal */
  getPersistenceQuery(key: string) {
    return this.rootRequests.get(key);
  }

  /** @internal */
  getPersistenceValue(key: string) {
    return this.rootValues.get(key);
  }

  /** @internal Merge a small disk read beneath optimistic layers. */
  restorePersistenceData(state: ClientHydrationState) {
    this.store.update(() => {
      const coverage = new Map(state.store.coverage);
      for (const [id, record] of state.store.records) {
        const existing = this.store.read(id);
        const paths = coverage.get(id) ?? [];
        this.store.merge(
          id,
          existing ? (mergePreservingExisting(record, existing) as AnyRecord) : record,
          paths,
        );
      }
      for (const [key, list] of state.store.lists) {
        if (!this.store.getListState(key)) {
          this.store.setList(key, list);
        }
      }
      for (const [key, id] of state.rootRequests) {
        if (!this.rootRequests.has(key)) {
          this.rootRequests.set(key, id);
        }
      }
      for (const [key, value] of state.rootValues ?? []) {
        if (!this.rootValues.has(key)) {
          this.rootValues.set(key, value);
        }
      }
      for (const [type, keys] of state.rootLists) {
        for (const key of keys) {
          this.registerRootList(type, key);
        }
      }
    });
  }

  /** @internal */
  getRetainedRequests() {
    return this.operationLifetime.getDescriptors();
  }

  /** @internal */
  restoreRetainedRequests(requests: ReadonlyArray<RequestDescriptor>) {
    this.operationLifetime.restore(requests);
  }

  /** @internal */
  hasMutation(key: string, entity: string): boolean {
    return this.mutationEntities?.get(key) === entity && this.types.has(entity);
  }

  private registerRootList(type: string, key: string) {
    let lists = this.rootLists.get(type);
    if (!lists) {
      lists = new Set();
      this.rootLists.set(type, lists);
    }

    lists.add(key);
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
      listState.unloaded ||
      (insert === 'before'
        ? Boolean(listState.pagination?.hasPrevious)
        : Boolean(listState.pagination?.hasNext));

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

  private insertIntoRootLists(type: string, entityId: EntityId, insert: InsertPosition) {
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

      this.store.setList(key, next);
    }
  }

  private exposeListTarget<T extends object>(target: T, metadata: ConnectionMetadata): T {
    Object.defineProperty(target, ConnectionTag, { value: metadata });
    this.listTargets.set(target, metadata);
    return target;
  }

  private nestedListMetadata(owner: EntityId, field: string, plan: SelectionPlan, path: string) {
    const { type } = parseEntityId(owner);
    const descriptor = this.types.get(type)?.fields?.[field];
    if (!descriptor || descriptor === 'scalar' || !('listOf' in descriptor)) {
      return undefined;
    }
    const args = plan.args.get(path);
    return {
      args: args?.value,
      field,
      hash: args?.hash,
      key: getListKey(owner, field, args?.hash),
      live: plan.live.get(path),
      owner,
      procedure: `${type}.${field}`,
      root: false,
      type: descriptor.listOf,
    } satisfies ConnectionMetadata;
  }

  /** @internal Capture a mutation's list identities without retaining its result snapshots. */
  resolveMutationInsertion(type: string, insert: MutationInsertion): ResolvedMutationInsertion {
    if (typeof insert === 'string') {
      if (insert !== 'none' && insert !== 'before' && insert !== 'after') {
        throw new Error('fate: Invalid mutation insertion position.');
      }
      return insert;
    }
    const targets: Array<ResolvedInsertion> = [];
    const positions = new Map<string, string>();
    for (const instruction of Array.isArray(insert) ? insert : [insert]) {
      if (
        !isRecord(instruction) ||
        (instruction.position !== 'before' && instruction.position !== 'after') ||
        !instruction.into ||
        typeof instruction.into !== 'object'
      ) {
        throw new Error('fate: Invalid scoped list insertion.');
      }
      const into = instruction.into;
      let metadata = this.listTargets.get(into);
      const deferred = isDeferred(into) && this.deferredTargets.has(into);
      if (deferred) {
        const reference = getDeferredMetadata(into);
        const owner = this.optimisticEntityResolutions.get(reference.owner) ?? reference.owner;
        if (!this.store.read(owner)) {
          throw new Error('fate: The insertion list owner is no longer cached.');
        }
        const descriptor = this.types.get(parseEntityId(owner).type)?.fields?.[reference.field];
        if (descriptor && descriptor !== 'scalar' && 'listOf' in descriptor) {
          metadata = this.nestedListMetadata(
            owner,
            reference.field,
            getDeferredSelectionPlan(reference.field, reference.selection),
            reference.field,
          );
        }
      }
      if (!metadata || (!deferred && !this.store.getListState(metadata.key))) {
        throw new Error('fate: Insertion requires a list returned by this client.');
      }
      if (metadata.type !== type && !this.types.get(metadata.type)?.possibleTypes?.includes(type)) {
        throw new Error(`fate: Cannot insert '${type}' into a '${metadata.type}' list.`);
      }
      if (
        !metadata.root &&
        this.store.read(metadata.owner)?.[argumentFieldKey(metadata.field, metadata.hash)] === null
      ) {
        continue;
      }
      const previous = positions.get(metadata.key);
      if (previous && previous !== instruction.position) {
        throw new Error('fate: Conflicting insertion positions for the same list.');
      }
      if (!previous) {
        const { field, hash, key, owner, procedure, root, type } = metadata;
        targets.push({
          list: { field, hash, key, owner, procedure, root, type },
          position: instruction.position,
        });
        positions.set(metadata.key, instruction.position);
      }
    }
    return targets;
  }

  /** @internal Keep targeted lists alive until an optimistic or durable operation settles. */
  retainMutationLists(insert: ResolvedMutationInsertion): () => void {
    if (typeof insert === 'string') {
      return () => {};
    }
    for (const { list } of insert) {
      const entry = this.mutationLists.get(list.key);
      this.mutationLists.set(list.key, { count: (entry?.count ?? 0) + 1, list });
    }
    let released = false;
    return () => {
      if (!released) {
        released = true;
        for (const { list } of insert) {
          const entry = this.mutationLists.get(list.key);
          if (entry && --entry.count === 0) {
            this.mutationLists.delete(list.key);
          }
        }
      }
    };
  }

  /** @internal Apply explicit membership changes in the caller's optimistic transaction. */
  insertMutationTargets(entityId: EntityId, targets: ReadonlyArray<ResolvedInsertion>) {
    for (const { list, position } of targets) {
      if (
        !list.root &&
        this.store.read(list.owner)?.[argumentFieldKey(list.field, list.hash)] === null
      ) {
        continue;
      }
      const previous = this.store.getListState(list.key) ?? { ids: [], unloaded: true };
      const { list: next } = this.applyListInsert(previous, entityId, position);
      if (next !== previous) {
        this.store.setList(list.key, next);
        if (!next.unloaded) {
          this.syncNestedConnectionOwnerField(list, entityId, next, 'insert');
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

  private getListNodeType(type: string, field: string): string {
    const descriptor = this.getTypeConfig(type).fields?.[field];
    if (!descriptor || descriptor === 'scalar' || !('listOf' in descriptor)) {
      throw new Error(`fate: Could not find node type for '${type}.${field}'.`);
    }
    return descriptor.listOf;
  }

  /** @internal Validates local wiring without requiring network connectivity. */
  validatePersistence(): void {
    if (this.mutationEntities?.size) {
      this.requireDurableMutationTransport();
    }
  }

  /** @internal */
  persistMutation(command: MutationCommand): Promise<unknown> {
    if (!this.persistenceRuntime) {
      throw new Error('fate: Persistence is not configured.');
    }
    return this.persistenceRuntime.mutate(command);
  }

  /** @internal */
  assertPersistenceActive(): void {
    if (
      this.persistenceDisposal?.signal.aborted ||
      this.persistence?.getSnapshot().status === 'disposed'
    ) {
      throw new Error('fate: Persistence was disposed.');
    }
  }

  /** @internal */
  disposePersistence(): void {
    this.persistenceDisposal?.abort();
    for (const { unsubscribe } of this.liveSubscriptions.values()) {
      try {
        unsubscribe();
      } catch {
        /* One transport cannot prevent the other subscriptions from closing. */
      }
    }
    this.liveSubscriptions.clear();
  }

  private requireDurableMutationTransport(): void {
    if (!this.transport.mutateDurably) {
      throw new FateRequestError(
        'BAD_REQUEST',
        'fate: Persisted mutations require transport.mutateDurably connected to a server idempotency handler. Configure that adapter, or use persist: false for immediate calls. Cache persistence remains available.',
      );
    }
  }

  async executeMutation(
    key: string,
    input: unknown,
    select: Set<string>,
    options: { args?: AnyRecord; identity?: MutationIdentity; plan?: SelectionPlan } = {},
  ): Promise<unknown> {
    if (options.identity) {
      this.requireDurableMutationTransport();
    } else if (!this.transport.mutate) {
      throw new Error(
        `fate: transport does not support mutations. Please provide a 'mutate' implementation in your transport.`,
      );
    }

    const entity = this.mutationEntities?.get(key);
    if (entity && entity !== '__value__') {
      select = new Set(expandRefetchSelection(this.types, entity, select));
    }
    const baseRecord = input && typeof input === 'object' ? (input as AnyRecord) : undefined;
    const separateSelectionArgs = this.transport.separateMutationSelectionArgs;
    const inputArgs =
      !separateSelectionArgs && baseRecord && typeof baseRecord.args === 'object'
        ? (baseRecord.args as AnyRecord)
        : undefined;
    const argsPayload = combineArgsPayload(
      options.plan ? resolvedArgsFromPlan(options.plan) : undefined,
      combineArgsPayload(inputArgs, options.args),
    );

    const requestInput = separateSelectionArgs
      ? input
      : argsPayload && baseRecord
        ? ({ ...baseRecord, args: argsPayload } as AnyRecord)
        : argsPayload
          ? ({ args: argsPayload } as AnyRecord)
          : input;

    return await this.trackPendingRequest(() =>
      options.identity
        ? separateSelectionArgs
          ? this.transport.mutateDurably!(
              key as any,
              requestInput as any,
              select,
              options.identity,
              argsPayload,
            )
          : this.transport.mutateDurably!(key as any, requestInput as any, select, options.identity)
        : separateSelectionArgs
          ? this.transport.mutate!(key as any, requestInput as any, select, argsPayload)
          : this.transport.mutate!(key as any, requestInput as any, select),
    );
  }

  write(
    type: string,
    data: AnyRecord,
    select: ReadonlySet<string>,
    plan?: SelectionPlan,
    insert?: InsertPosition,
  ) {
    return this.writeEntity(type, data, select, plan, null, insert);
  }

  /** @internal Normalize mutation snapshots while retaining unrelated loaded pages. */
  writeMutationResult(
    type: string,
    data: AnyRecord,
    select: ReadonlySet<string>,
    plan?: SelectionPlan,
    insert?: InsertPosition,
  ) {
    const previous = this.mutationWrite;
    const fields = plan ? new Set<string>() : undefined;
    if (fields && plan) {
      for (const path of plan.paths) {
        const parts = path.split('.');
        for (let index = 1; index <= parts.length; index++) {
          fields.add(parts.slice(0, index).join('.'));
        }
      }
    }
    this.mutationWrite = { fields };
    try {
      return this.write(type, data, select, plan, insert);
    } finally {
      this.mutationWrite = previous;
    }
  }

  deleteRecord(type: string, id: string | number) {
    return this.store.update(() => {
      const entityId = toEntityId(type, id);

      this.viewDataCache.invalidate(entityId);
      this.stableRefs.delete(entityId);
      this.store.deleteRecord(entityId);
      this.store.removeReferencesTo(entityId, this.viewDataCache);
    });
  }

  private stableRefWithViewNames<TName extends string>(
    type: TName,
    id: string | number,
    viewNames: ReadonlySet<string>,
  ): ViewRef<TName> {
    const entityId = toEntityId(type, id);
    const key = `${typeof id}:${String(id)}:${[...viewNames].sort().join(',')}`;
    let refs = this.stableRefs.get(entityId);
    if (!refs) {
      refs = new Map();
      this.stableRefs.set(entityId, refs);
    }

    const existing = refs.get(key);
    if (existing) {
      return existing as ViewRef<TName>;
    }

    const ref = createRefWithViewNames(type, id, viewNames);
    refs.set(key, ref);
    return ref;
  }

  ref<T extends Entity>(
    type: T['__typename'],
    id: string | number,
    view: View<T, Selection<T>>,
  ): ViewRef<T['__typename']> {
    return this.stableRefWithViewNames(type, id, getViewNames(view));
  }

  rootListRef(entityId: EntityId, rootView: View<any, any>) {
    const { id, type } = parseEntityId(entityId);
    return this.stableRefWithViewNames(type, id, getRootViewNames(rootView));
  }

  readView<T extends Entity, S extends Selection<T>, V extends View<T, S>>(
    view: V,
    ref: ViewRef<T['__typename']>,
  ): FateThenable<ViewSnapshot<T, S>> {
    return this.readViewInternal(view, ref, undefined);
  }

  /** @internal Keeps failures stable across discarded React render attempts. */
  readViewForRender<T extends Entity, S extends Selection<T>, V extends View<T, S>>(
    view: V,
    ref: ViewRef<T['__typename']>,
    scope?: object,
  ): FateThenable<ViewSnapshot<T, S>> {
    return this.readViewInternal(view, ref, scope ?? null);
  }

  private readViewInternal<T extends Entity, S extends Selection<T>, V extends View<T, S>>(
    view: V,
    ref: ViewRef<T['__typename']>,
    renderScope: object | null | undefined,
  ): FateThenable<ViewSnapshot<T, S>> {
    view = resolveView(view, ref);
    const persistence = this.persistence;
    if (persistence && persistence.getSnapshot().status !== 'ready') {
      const key = `restore:${ref.__typename}:${ref.id}:${[...getViewNames(view)].sort().join(',')}`;
      return this.renderReadErrors.read(view, ref, renderScope, key, () => {
        let pending = this.pending.get(key);
        if (!pending) {
          pending = persistence.ready
            .then(() => {
              if (this.persistence?.getSnapshot().status === 'disposed') {
                throw new Error('fate: Persistence was disposed.');
              }
              return this.readViewInternal<T, S, V>(view, ref, renderScope);
            })
            .finally(() => this.pending.delete(key));
          this.pending.set(key, pending);
        }
        return pending as FateThenable<ViewSnapshot<T, S>>;
      }) as FateThenable<ViewSnapshot<T, S>>;
    }
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
      return this.readViewInternal<T, S, V>(
        view,
        this.stableRefWithViewNames(resolvedType, resolvedId, getViewNames(view)),
        renderScope,
      );
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
      this.renderReadErrors.clear(view, ref);
      return cached as FateThenable<ViewSnapshot<T, S>>;
    }

    const plan = getSelectionPlan(view, ref);
    const selectedPaths = plan.paths;
    const missing = this.missingForSelection(entityId, selectedPaths, plan);

    const resolveSnapshot = () => {
      this.renderReadErrors.clear(view, ref);
      const resolvedView = this.readViewSelection<T, S>(view, ref, entityId, plan);
      if (this.cacheOnlyRefs.has(ref)) {
        this.markCacheOnly(resolvedView.data);
      }

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
      if (this.cacheOnlyRefs.has(ref)) {
        throw new Error('fate: Cache-only view is missing selected fields.');
      }
      const key = this.pendingKey(
        entityId,
        new Set([...missing].map((path) => getStoragePath(path, plan))),
      );

      return this.renderReadErrors.read(view, ref, renderScope, key, () => {
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

        const promise = this.trackPendingRequest(async () => {
          try {
            const persistence = this.persistenceRuntime;
            if (persistence) {
              const persistedRequest: RequestDescriptor = {
                items: [
                  {
                    ids: [id],
                    kind: 'node',
                    name: type,
                    plan,
                    refViewNames: new Set(),
                    type,
                    viewSignature: '',
                  },
                ],
                key: `view:${key}`,
              };
              await persistence.restoreRequest(persistedRequest);
              const remaining = this.missingForSelection(entityId, selectedPaths, plan);
              if (remaining.size) {
                await this.fetchByIdAndNormalize(type, [id], remaining, plan);
                persistence.fetched({
                  ...persistedRequest,
                  items: persistedRequest.items.map((item) => ({
                    ...item,
                    plan: { ...item.plan, paths: remaining },
                  })),
                  key: `${persistedRequest.key}:${JSON.stringify([...remaining].sort())}`,
                });
              }
            } else {
              await this.fetchByIdAndNormalize(type, [id], missing, plan);
            }
            const remainingMissing = this.missingForSelection(entityId, selectedPaths, plan);

            if (remainingMissing.size > 0) {
              this.stalledRequests.add(key);
              return resolveSnapshot();
            }

            this.stalledRequests.delete(key);
            return this.readView<T, S, V>(view, ref);
          } finally {
            this.pending.delete(key);
          }
        });

        this.pending.set(key, promise);

        return promise as unknown as FateThenable<ViewSnapshot<T, S>>;
      }) as FateThenable<ViewSnapshot<T, S>>;
    }
    return resolveSnapshot();
  }

  readDeferred<T>(deferred: Deferred<T>): PromiseLike<DeferredSnapshot<T>> {
    return this.readDeferredInternal(deferred, undefined);
  }

  /** @internal Keeps deferred failures stable across discarded React renders. */
  readDeferredForRender<T>(
    deferred: Deferred<T>,
    scope?: object,
  ): PromiseLike<DeferredSnapshot<T>> {
    return this.readDeferredInternal(deferred, scope ?? null);
  }

  private readDeferredInternal<T>(
    deferred: Deferred<T>,
    renderScope: object | null | undefined,
  ): PromiseLike<DeferredSnapshot<T>> {
    const metadata = getDeferredMetadata(deferred);
    const resolvedOwner = this.optimisticEntityResolutions.get(metadata.owner) ?? metadata.owner;
    const parsedOwner = parseEntityId(resolvedOwner);
    const ownerRecord = this.store.read(resolvedOwner);
    const rawOwnerId =
      ownerRecord && (typeof ownerRecord.id === 'string' || typeof ownerRecord.id === 'number')
        ? ownerRecord.id
        : parsedOwner.id;
    const ownerType = parsedOwner.type || metadata.type;
    const plan = getDeferredSelectionPlan(metadata.field, metadata.selection);
    const selectedPaths = plan.paths;
    const missing = this.missingForSelection(resolvedOwner, selectedPaths, plan);
    const hasMissingList = () =>
      this.hasMissingDeferredList(resolvedOwner, ownerType, metadata.field, plan);
    const listMissing = hasMissingList();
    const fetchPaths = listMissing ? selectedPaths : missing;

    const resolveSnapshot = () => {
      this.renderReadErrors.clear(deferred, deferred);
      const snapshot = this.readViewSelection(
        { [metadata.field]: metadata.selection } as View<any, any>,
        this.stableRefWithViewNames(ownerType, rawOwnerId, new Set()),
        resolvedOwner,
        plan,
      );
      const resolved = {
        coverage: snapshot.coverage,
        data: (snapshot.data as AnyRecord)[metadata.field] as T,
      };

      return {
        status: 'fulfilled',
        then: <TResult1 = DeferredSnapshot<T>, TResult2 = never>(
          onfulfilled?: (value: DeferredSnapshot<T>) => TResult1 | PromiseLike<TResult1>,
          onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
        ): PromiseLike<TResult1 | TResult2> =>
          Promise.resolve(resolved).then(onfulfilled, onrejected),
        value: resolved,
      } as const;
    };

    if (missing.size === 0 && !listMissing) {
      this.clearStalledRequestsForEntity(resolvedOwner);
      return resolveSnapshot();
    }

    const key = this.deferredPendingKey(
      resolvedOwner,
      fetchPaths,
      plan,
      this.deferredSelectionSignature(metadata.selection),
    );
    if (this.stalledRequests.has(key)) {
      return resolveSnapshot();
    }

    return this.renderReadErrors.read(deferred, deferred, renderScope, key, () => {
      const pendingOptimistic = this.getPendingOptimisticMutations(resolvedOwner);
      if (pendingOptimistic) {
        const pending = this.pendingDeferred.get(key);
        if (pending) {
          return pending as PromiseLike<DeferredSnapshot<T>>;
        }

        const promise = Promise.all(pendingOptimistic)
          .then(() => this.readDeferred(deferred))
          .finally(() => this.pendingDeferred.delete(key));

        this.pendingDeferred.set(key, promise);
        return promise as PromiseLike<DeferredSnapshot<T>>;
      }

      const pendingPromise = this.pendingDeferred.get(key) || null;
      if (pendingPromise) {
        return pendingPromise as PromiseLike<DeferredSnapshot<T>>;
      }

      const promise = this.trackPendingRequest(async () => {
        try {
          await this.fetchByIdAndNormalize(ownerType, [rawOwnerId], fetchPaths, plan);
          const remainingMissing = this.missingForSelection(resolvedOwner, selectedPaths, plan);

          if (remainingMissing.size > 0 || hasMissingList()) {
            this.stalledRequests.add(key);
            return resolveSnapshot().value;
          }

          this.stalledRequests.delete(key);
          return (this.readDeferred(deferred) as FateThenable<DeferredSnapshot<T>>).value;
        } finally {
          this.pendingDeferred.delete(key);
        }
      });

      this.pendingDeferred.set(key, promise);
      return promise;
    });
  }

  assertLiveViewSupport() {
    if (!this.transport.subscribeById) {
      throw new Error(
        `fate: transport does not support live views. Please provide a 'subscribeById' implementation in your transport.`,
      );
    }
  }

  assertLiveConnectionSupport() {
    if (!this.transport.subscribeConnection) {
      throw new Error(
        `fate: transport does not support live list views. Please provide a 'subscribeConnection' implementation in your transport.`,
      );
    }
  }

  subscribeLiveView<T extends Entity, S extends Selection<T>, V extends View<T, S>>(
    view: V,
    ref: ViewRef<T['__typename']>,
  ): () => void {
    view = resolveView(view, ref);
    this.assertPersistenceActive();

    const id = ref.id;
    const type = ref.__typename;
    if (id == null) {
      throw new Error(
        `fate: Invalid live view reference. Expected 'id' to be provided as part of the reference.`,
      );
    }

    if (type == null) {
      throw new Error(
        `fate: Invalid live view reference. Expected '__typename' to be provided as part of the reference.`,
      );
    }

    const viewNames = getViewNames(view);
    const refViews = ref[ViewsTag];

    if (!refViews || ![...viewNames].every((name) => refViews.has(name))) {
      const received = refViews ? [...refViews].join(', ') : JSON.stringify(ref);

      throw new Error(
        `fate: Invalid live view reference. Expected the provided ref to include the view(s) '${[...viewNames].join("', '")}', received '${received}'.`,
      );
    }

    const entityId = toEntityId(type, id);
    const plan = getSelectionPlan(view, ref, { includeNestedViews: true });
    if (plan.paths.size === 0) {
      return () => {};
    }
    this.assertLiveViewSupport();
    const key = this.liveSubscriptionKey(entityId, plan);
    const existing = this.liveSubscriptions.get(key);
    if (existing) {
      existing.count += 1;
      existing.releaseScheduled = false;
      return () => {
        this.releaseLiveSubscription(key);
      };
    }

    const args = resolvedArgsFromPlan(plan);
    let unsubscribe: () => void;
    try {
      unsubscribe = this.transport.subscribeById!(type, id, plan.paths, args, {
        onData: (record, liveSelect) => {
          if (this.persistenceDisposal?.signal.aborted || !record || typeof record !== 'object') {
            return;
          }

          const select = new Set(liveSelect ?? plan.paths);

          this.write(type, record as AnyRecord, select, plan, 'none');
        },
        onDelete: (deletedId) => {
          if (this.persistenceDisposal?.signal.aborted) {
            return;
          }
          this.deleteRecord(type, deletedId ?? id);
        },
        onError: (error) => {
          if (!this.persistenceDisposal?.signal.aborted) {
            this.reportLiveError(error);
          }
        },
      });
    } catch (error) {
      this.reportLiveError(error);
      return emptyDispose;
    }

    if (this.persistenceDisposal?.signal.aborted) {
      unsubscribe();
      return emptyDispose;
    }
    this.liveSubscriptions.set(key, { count: 1, unsubscribe });

    return () => {
      this.releaseLiveSubscription(key);
    };
  }

  subscribeLiveListView<V extends View<any, any>>(
    view: V,
    connection: ConnectionMetadata,
  ): () => void {
    this.assertPersistenceActive();
    this.assertLiveConnectionSupport();

    const plan = getSelectionPlan(view, null);
    const connectionArgs = filterConnectionArgs(
      connection.root
        ? connection.args
        : { ...connection.args, id: parseEntityId(connection.owner).id },
    );
    const selectionArgs = resolvedArgsFromPlan(plan);
    const key = this.liveConnectionSubscriptionKey(connection, plan, connectionArgs);
    const existing = this.liveSubscriptions.get(key);
    if (existing) {
      existing.count += 1;
      existing.releaseScheduled = false;
      return () => {
        this.releaseLiveSubscription(key);
      };
    }

    let unsubscribe: () => void;
    try {
      unsubscribe = this.transport.subscribeConnection!(
        connection.procedure,
        connection.type,
        connectionArgs,
        plan.paths,
        selectionArgs,
        {
          onError: (error) => {
            if (!this.persistenceDisposal?.signal.aborted) {
              this.reportLiveError(error);
            }
          },
          onEvent: (event) => {
            if (this.persistenceDisposal?.signal.aborted) {
              return;
            }
            this.applyLiveConnectionEvent(view, connection, plan, event);
          },
        },
      );
    } catch (error) {
      this.reportLiveError(error);
      return emptyDispose;
    }

    if (this.persistenceDisposal?.signal.aborted) {
      unsubscribe();
      return emptyDispose;
    }
    this.liveSubscriptions.set(key, { count: 1, unsubscribe });

    return () => {
      this.releaseLiveSubscription(key);
    };
  }

  private applyLiveConnectionEvent<V extends View<any, any>>(
    view: V,
    connection: ConnectionMetadata,
    plan: SelectionPlan,
    event: FateLiveConnectionEvent,
  ) {
    return this.store.update(() => {
      if (event.type === 'invalidate') {
        this.invalidateLiveConnection(view, connection);
        return;
      }

      if (event.type === 'deleteEdge') {
        this.deleteConnectionEdge(connection, toEntityId(event.nodeType, event.id));
        return;
      }

      const node = event.edge.node;
      if (!node || typeof node !== 'object') {
        return;
      }

      const nodeRecord = node as AnyRecord;
      const nodeType = event.nodeType;
      if (!nodeType) {
        this.reportLiveError(
          new Error(
            `fate: Live connection event for '${connection.procedure}' did not include a node type.`,
          ),
        );
        return;
      }

      const entityId = this.write(nodeType, nodeRecord, plan.paths, plan, 'none');
      this.insertConnectionEdge(
        connection.key,
        entityId,
        event.edge.cursor,
        event.type,
        event.targetCursor,
        view,
        connection,
      );
    });
  }

  private invalidateLiveConnection<V extends View<any, any>>(
    view: V,
    connection: ConnectionMetadata,
  ) {
    const token = ++this.liveConnectionInvalidationToken;
    this.liveConnectionInvalidations.set(connection.key, token);
    const previous = this.store.getListState(connection.key);
    this.store.restoreList(connection.key, undefined);
    this.loadConnection(view, connection, connection.args ?? {})
      .then(() => {
        if (this.liveConnectionInvalidations.get(connection.key) === token) {
          this.liveConnectionInvalidations.delete(connection.key);
        }
      })
      .catch((error) => {
        if (this.liveConnectionInvalidations.get(connection.key) === token) {
          this.store.restoreList(connection.key, previous);
          this.liveConnectionInvalidations.delete(connection.key);
        }
        this.reportLiveError(error);
      });
  }

  private deleteConnectionEdge(connection: ConnectionMetadata, entityId: EntityId) {
    const listState = this.store.getListState(connection.key);
    if (!listState) {
      this.syncNestedConnectionOwnerField(connection, entityId, undefined, 'delete');
      return;
    }

    const ids: Array<EntityId> = [];
    const cursors = listState.cursors ? ([] as Array<string | undefined>) : undefined;
    let changed = false;

    listState.ids.forEach((id, index) => {
      if (id === entityId) {
        changed = true;
        return;
      }
      ids.push(id);
      if (cursors) {
        cursors.push(listState.cursors?.[index]);
      }
    });

    const liveAfterIds = removeListId(listState.liveAfterIds, entityId);
    const liveBeforeIds = removeListId(listState.liveBeforeIds, entityId);
    const pendingAfterIds = removeListId(listState.pendingAfterIds, entityId);
    const pendingBeforeIds = removeListId(listState.pendingBeforeIds, entityId);
    changed =
      changed ||
      liveAfterIds?.length !== listState.liveAfterIds?.length ||
      liveBeforeIds?.length !== listState.liveBeforeIds?.length ||
      pendingAfterIds?.length !== listState.pendingAfterIds?.length ||
      pendingBeforeIds?.length !== listState.pendingBeforeIds?.length;

    if (changed) {
      const nextListState = {
        ...listState,
        cursors,
        ids,
        liveAfterIds,
        liveBeforeIds,
        pendingAfterIds,
        pendingBeforeIds,
      };
      this.store.setList(connection.key, nextListState);
      this.syncNestedConnectionOwnerField(connection, entityId, nextListState, 'delete');
      return;
    }

    this.syncNestedConnectionOwnerField(connection, entityId, listState, 'delete');
  }

  private insertConnectionEdge(
    key: string,
    entityId: EntityId,
    cursor: string | undefined,
    type: Exclude<FateLiveConnectionEvent['type'], 'deleteEdge' | 'invalidate'>,
    targetCursor: string | undefined,
    view: View<any, any>,
    connection: ConnectionMetadata,
  ) {
    const listState = this.store.getListState(key) ?? { ids: [] };
    const isAppendEvent = type === 'appendEdge' || type === 'appendNode';
    const isPrependEvent = type === 'prependEdge' || type === 'prependNode';
    const appendMode = connection.live?.append ?? 'edge';
    const prependMode = connection.live?.prepend ?? 'edge';

    if (
      (isAppendEvent && listState.pendingAfterIds?.includes(entityId)) ||
      (isPrependEvent && listState.pendingBeforeIds?.includes(entityId))
    ) {
      this.syncNestedConnectionOwnerField(connection, entityId, listState, 'insert');
      return;
    }

    const visibleIndex = listState.ids.indexOf(entityId);
    const isVisibleAppendEvent = isAppendEvent && appendMode === 'visible';
    const isVisiblePrependEvent = isPrependEvent && prependMode === 'visible';
    if (visibleIndex >= 0 && (isVisibleAppendEvent || isVisiblePrependEvent)) {
      const nextListState =
        cursor === undefined
          ? listState
          : {
              ...listState,
              cursors: listState.ids.map((_, index) =>
                index === visibleIndex ? cursor : listState.cursors?.[index],
              ),
            };

      if (nextListState !== listState) {
        this.store.setList(key, nextListState);
      }
      this.syncNestedConnectionOwnerField(connection, entityId, nextListState, 'insert');
      return;
    }

    const withoutExisting = this.removeEntityFromListState(listState, entityId);
    const keepLiveBeforeHidden =
      isPrependEvent &&
      prependMode !== 'visible' &&
      (Boolean(withoutExisting.pagination?.hasPrevious) ||
        isConnectionWindowFull(withoutExisting, connection, 'backward'));
    const keepLiveAfterHidden =
      isAppendEvent &&
      appendMode !== 'visible' &&
      (Boolean(withoutExisting.pagination?.hasNext) ||
        isConnectionWindowFull(withoutExisting, connection, 'forward'));
    const keepVisibleBeforePending =
      isPrependEvent &&
      prependMode === 'visible' &&
      (withoutExisting.pagination?.hasPrevious === true ||
        (withoutExisting.pagination?.hasPrevious === undefined &&
          isConnectionWindowFull(withoutExisting, connection, 'backward')));
    const keepVisibleAfterPending =
      isAppendEvent &&
      appendMode === 'visible' &&
      (withoutExisting.pagination?.hasNext === true ||
        (withoutExisting.pagination?.hasNext === undefined &&
          isConnectionWindowFull(withoutExisting, connection, 'forward')));

    if (keepLiveBeforeHidden) {
      const nextList = markConnectionPageAvailable(withoutExisting, 'backward');
      const nextListState = {
        ...nextList,
        liveBeforeIds: [entityId, ...(nextList.liveBeforeIds ?? [])],
      };
      this.store.setList(key, nextListState);
      this.syncNestedConnectionOwnerField(connection, entityId, nextListState, 'insert');
      return;
    }

    if (keepLiveAfterHidden) {
      const nextList = markConnectionPageAvailable(withoutExisting, 'forward');
      const nextListState = {
        ...nextList,
        liveAfterIds: [...(nextList.liveAfterIds ?? []), entityId],
      };
      this.store.setList(key, nextListState);
      this.syncNestedConnectionOwnerField(connection, entityId, nextListState, 'insert');
      return;
    }

    if (keepVisibleBeforePending) {
      const nextList = markConnectionPageAvailable(withoutExisting, 'backward');
      const nextListState = {
        ...nextList,
        pendingBeforeIds: [entityId, ...(nextList.pendingBeforeIds ?? [])],
      };
      this.store.setList(key, nextListState);
      this.syncNestedConnectionOwnerField(connection, entityId, nextListState, 'insert');
      return;
    }

    if (keepVisibleAfterPending) {
      const nextList = markConnectionPageAvailable(withoutExisting, 'forward');
      const nextListState = {
        ...nextList,
        pendingAfterIds: [...(nextList.pendingAfterIds ?? []), entityId],
      };
      this.store.setList(key, nextListState);
      this.syncNestedConnectionOwnerField(connection, entityId, nextListState, 'insert');
      return;
    }

    const index = this.getConnectionInsertIndex(withoutExisting, type, targetCursor);
    if (index == null) {
      this.invalidateLiveConnection(view, connection);
      return;
    }
    const ids = [...withoutExisting.ids];
    ids.splice(index, 0, entityId);

    const shouldStoreCursors = Boolean(withoutExisting.cursors) || cursor !== undefined;
    const cursors = shouldStoreCursors ? [...(withoutExisting.cursors ?? [])] : undefined;
    if (cursors) {
      while (cursors.length < withoutExisting.ids.length) {
        cursors.push(undefined);
      }
      cursors.splice(index, 0, cursor);
    }

    const nextListState = {
      ...withoutExisting,
      cursors,
      ids,
      liveAfterIds: removeListId(withoutExisting.liveAfterIds, entityId),
      liveBeforeIds: removeListId(withoutExisting.liveBeforeIds, entityId),
    };
    this.store.setList(key, nextListState);
    this.syncNestedConnectionOwnerField(connection, entityId, nextListState, 'insert');
  }

  private syncNestedConnectionOwnerField(
    connection: ConnectionMetadata,
    entityId: EntityId,
    listState: List | undefined,
    action: 'delete' | 'insert',
  ) {
    if (connection.root) {
      return;
    }

    const owner = this.store.read(connection.owner);
    const current = Array.isArray(owner?.[argumentFieldKey(connection.field, connection.hash)])
      ? (owner?.[argumentFieldKey(connection.field, connection.hash)] as Array<unknown>)
      : [];
    const currentIds = current
      .map((item) => (isNodeRef(item) ? getNodeRefId(item) : null))
      .filter((id): id is EntityId => id != null);
    const nextIds = currentIds.filter((id) => id !== entityId);

    if (action === 'insert' && listState) {
      const visibleIds = getListEntries(listState).map(({ id }) => id);
      const visibleIndex = visibleIds.indexOf(entityId);

      if (visibleIndex >= 0) {
        const nextIndexById = new Map(nextIds.map((id, index) => [id, index]));
        let insertIndex: number | null = null;
        for (let index = visibleIndex - 1; index >= 0; index -= 1) {
          const currentIndex = nextIndexById.get(visibleIds[index]);
          if (currentIndex != null) {
            insertIndex = currentIndex + 1;
            break;
          }
        }

        if (insertIndex == null) {
          for (let index = visibleIndex + 1; index < visibleIds.length; index += 1) {
            const currentIndex = nextIndexById.get(visibleIds[index]);
            if (currentIndex != null) {
              insertIndex = currentIndex;
              break;
            }
          }
        }

        nextIds.splice(insertIndex ?? (visibleIndex === 0 ? 0 : nextIds.length), 0, entityId);
      }
    }

    if (
      currentIds.length === nextIds.length &&
      currentIds.every((id, index) => id === nextIds[index])
    ) {
      return;
    }

    this.viewDataCache.invalidate(connection.owner);
    this.store.merge(
      connection.owner,
      {
        [argumentFieldKey(connection.field, connection.hash)]: createNodeRefsForIds(
          nextIds,
          current,
        ),
      },
      [argumentFieldKey(connection.field, connection.hash)],
    );
  }

  private getConnectionInsertIndex(
    listState: List,
    type: Exclude<FateLiveConnectionEvent['type'], 'deleteEdge' | 'invalidate'>,
    targetCursor: string | undefined,
  ): number | null {
    if (type === 'prependEdge' || type === 'prependNode') {
      return 0;
    }

    if (type === 'appendEdge' || type === 'appendNode') {
      return listState.ids.length;
    }

    if (targetCursor && listState.cursors) {
      const index = listState.cursors.indexOf(targetCursor);
      if (index >= 0) {
        return type === 'insertEdgeBefore' ? index : index + 1;
      }
    }

    return null;
  }

  private removeEntityFromListState(listState: List, entityId: EntityId): List {
    const ids: Array<EntityId> = [];
    const cursors = listState.cursors ? ([] as Array<string | undefined>) : undefined;

    listState.ids.forEach((id, index) => {
      if (id === entityId) {
        return;
      }
      ids.push(id);
      if (cursors) {
        cursors.push(listState.cursors?.[index]);
      }
    });

    return {
      ...listState,
      cursors,
      ids,
      liveAfterIds: removeListId(listState.liveAfterIds, entityId),
      liveBeforeIds: removeListId(listState.liveBeforeIds, entityId),
      pendingAfterIds: removeListId(listState.pendingAfterIds, entityId),
      pendingBeforeIds: removeListId(listState.pendingBeforeIds, entityId),
    };
  }

  private mergeListState(
    previous: List | undefined,
    incomingIds: ReadonlyArray<EntityId>,
    incomingCursors: ReadonlyArray<string | undefined>,
    incomingPagination: Pagination | undefined,
    options: {
      direction: 'forward' | 'backward';
      hasCursorArg: boolean;
      pageLimit?: number | null;
      replace?: boolean;
    },
  ): List {
    // A snapshot starts a new window; only cursor pages extend the old one.
    const previousWindow = options.replace && !options.hasCursorArg ? undefined : previous;
    const existingIds = previousWindow?.ids ?? [];
    const existingSet = new Set(existingIds);
    const isBackward = options.direction === 'backward';

    const mergeIds = () => {
      if (!previousWindow) {
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
    if (previousWindow?.cursors) {
      previousWindow.cursors.forEach((cursor, index) => {
        cursorMap.set(existingIds[index], cursor);
      });
    }
    incomingCursors.forEach((cursor, index) => {
      if (cursor !== undefined) {
        cursorMap.set(incomingIds[index], cursor);
      }
    });

    const shouldStoreCursors =
      hasIncomingCursor || Boolean(previousWindow?.cursors) || options.hasCursorArg;
    const cursors = shouldStoreCursors ? ids.map((id) => cursorMap.get(id)) : undefined;

    const previousPagination = previousWindow?.pagination;
    const newPagination = incomingPagination;
    // Cursor pages extend one edge of the accumulated list. Keep the other
    // edge's flag and cursor instead of replacing them with the new page's.
    const extendsExistingList = options.hasCursorArg && existingIds.length > 0;
    const leadingPagination =
      extendsExistingList && !isBackward ? (previousPagination ?? newPagination) : newPagination;
    const trailingPagination =
      extendsExistingList && isBackward ? (previousPagination ?? newPagination) : newPagination;

    const pagination =
      previousPagination || newPagination
        ? {
            hasNext: !!(trailingPagination?.hasNext ?? previousPagination?.hasNext),
            hasPrevious: !!(leadingPagination?.hasPrevious ?? previousPagination?.hasPrevious),
            nextCursor: trailingPagination?.nextCursor ?? previousPagination?.nextCursor,
            previousCursor: leadingPagination?.previousCursor ?? previousPagination?.previousCursor,
          }
        : undefined;

    return {
      backwardPageLimit:
        !options.hasCursorArg && isBackward && options.pageLimit != null
          ? Math.max(previousWindow?.backwardPageLimit ?? 0, options.pageLimit)
          : previousWindow?.backwardPageLimit,
      cursors,
      forwardPageLimit:
        !options.hasCursorArg && !isBackward && options.pageLimit != null
          ? Math.max(previousWindow?.forwardPageLimit ?? 0, options.pageLimit)
          : previousWindow?.forwardPageLimit,
      ids,
      liveAfterIds: dropCanonicalListIds(previous?.liveAfterIds, ids),
      liveBeforeIds: dropCanonicalListIds(previous?.liveBeforeIds, ids),
      pagination,
      pendingAfterIds: dropCanonicalListIds(previous?.pendingAfterIds, ids),
      pendingBeforeIds: dropCanonicalListIds(previous?.pendingBeforeIds, ids),
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

  private getPendingOptimisticMutations(
    entityId: EntityId,
  ): ReadonlyArray<Promise<unknown>> | null {
    const pending = this.pendingOptimisticMutations.get(entityId);
    return pending && pending.size > 0 ? [...pending] : null;
  }

  async loadConnection<V extends View<any, any>>(
    view: V,
    connection: ConnectionMetadata,
    args: Record<string, unknown>,
    options: { direction?: 'forward' | 'backward' } = {},
  ) {
    const requestArgs = omitUndefinedValues({ ...connection.args, ...args });
    const selection = resolveSelectionPlan(view, requestArgs);
    const key = hashArgs({
      args: selection.argsPayload,
      connection: connection.key,
      direction: options.direction ?? 'forward',
      field: connection.field,
      invalidation: this.liveConnectionInvalidations.get(connection.key),
      owner: connection.owner,
      refresh: this.writeVersions.get(`refresh:list:${connection.key}`),
      root: connection.root ?? false,
      select: [...selection.plan.paths].sort(),
      type: connection.type,
    });
    const pending = this.connectionRequests.get(key);
    if (pending) {
      return await pending;
    }
    const request = this.trackPendingRequest(() =>
      this.loadConnectionInternal(connection, requestArgs, selection, options),
    );
    this.connectionRequests.set(key, request);
    try {
      return await request;
    } finally {
      this.connectionRequests.delete(key);
    }
  }

  private async loadConnectionInternal(
    connection: ConnectionMetadata,
    requestArgs: Record<string, unknown>,
    { argsPayload, plan }: ReturnType<typeof resolveSelectionPlan>,
    options: { direction?: 'forward' | 'backward' } = {},
  ) {
    let generation = ++this.writeGeneration;
    const direction = options.direction ?? 'forward';
    const isPage = getPaginationMergeInfo(requestArgs).hasCursorArg;
    const listVersionKey = `list:${connection.key}`;
    const refreshVersionKey = `refresh:${listVersionKey}`;
    const refreshVersion = this.writeVersions.get(refreshVersionKey);
    const acceptsList = () =>
      isPage
        ? this.writeVersions.get(refreshVersionKey) === refreshVersion &&
          (this.writeVersions.get(refreshVersionKey) ?? 0) <= generation
        : (this.writeVersions.get(listVersionKey) ?? 0) <= generation;
    const applyResponse = <T>(apply: () => T) =>
      isPage
        ? this.withPaginationWrite(connection.key, generation, apply)
        : this.withWriteGeneration(generation, apply);
    if (connection.root) {
      if (!this.transport.fetchList) {
        throw new Error(
          `fate: transport does not support list fetching. Please add support for 'fetchList' in your transport.`,
        );
      }

      const connectionResult = await this.transport.fetchList(
        connection.field,
        expandRefetchSelection(this.types, connection.type, plan.paths),
        argsPayload,
      );
      this.assertPersistenceActive();

      if (connectionResult === null) {
        return this.store.getListState(connection.key);
      }
      const { items, pagination } = connectionResult;

      if (!items) {
        return this.store.getListState(connection.key);
      }

      applyResponse(() =>
        this.store.update(() => {
          const incomingIds: Array<EntityId> = [];
          const incomingCursors: Array<string | undefined> = [];

          for (const entry of items) {
            const id = this.write(
              connection.type,
              entry.node as AnyRecord,
              plan.paths,
              plan,
              'none',
            );
            if (!this.store.read(id)) {
              continue;
            }
            incomingIds.push(id);
            incomingCursors.push(entry.cursor);
          }

          // A refresh replaces the page window; independent page loads can still merge.
          if (!acceptsList()) {
            return;
          }
          const previous = this.store.getListState(connection.key);

          const nextListState = this.mergeListState(
            previous,
            incomingIds,
            incomingCursors,
            pagination,
            { ...getPaginationMergeInfo(requestArgs), replace: true },
          );

          if (!filterConnectionArgs(connection.args)) {
            this.registerRootList(connection.type, connection.key);
          }
          this.store.setList(connection.key, nextListState);
        }),
      );
      return this.store.getListState(connection.key);
    }

    const owner = parseEntityId(connection.owner);
    const nodeSelection = plan.paths;
    const scopedArgsPayload = argsPayload
      ? scopeArgsPayload(argsPayload, connection.field)
      : undefined;

    const parentSelection = new Set<string>();
    for (const path of nodeSelection) {
      parentSelection.add(`${connection.field}.${path}`);
    }

    const [response] = await this.fetchEntities(
      owner.type,
      [owner.id],
      parentSelection,
      generation,
      scopedArgsPayload,
    );
    this.assertPersistenceActive();

    generation = response?.generation ?? generation;
    const parentRecord = response?.record;
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

    applyResponse(() =>
      this.store.update(() => {
        const incomingIds: Array<EntityId> = [];
        const incomingCursors: Array<string | undefined> = [];

        const nodeType = this.getListNodeType(owner.type, connection.field);

        for (const entry of connectionPayload.items) {
          const { node } = entry;
          const id = this.write(nodeType, node, nodeSelection, plan, 'none');
          if (!this.store.read(id)) {
            continue;
          }
          incomingIds.push(id);
          incomingCursors.push(entry.cursor);
        }

        if (
          !acceptsList() ||
          (this.writeVersions.get(JSON.stringify([connection.owner])) ?? 0) > generation
        ) {
          return;
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
          { ...getPaginationMergeInfo(argsPayload), direction, hasCursorArg: true, replace: true },
        );

        this.store.setList(connection.key, nextListState);

        const current = this.store.read(connection.owner);
        const existingField = Array.isArray(
          current?.[argumentFieldKey(connection.field, connection.hash)],
        )
          ? (current?.[argumentFieldKey(connection.field, connection.hash)] as Array<unknown>) || []
          : [];
        const nodeRefs = createNodeRefsForIds(newIds, undefined);
        const nextField =
          direction === 'forward'
            ? [...existingField, ...nodeRefs]
            : [...nodeRefs, ...existingField];

        this.viewDataCache.invalidate(connection.owner);
        this.store.merge(
          connection.owner,
          { [argumentFieldKey(connection.field, connection.hash)]: nextField },
          [argumentFieldKey(connection.field, connection.hash)],
        );
      }),
    );
    return this.store.getListState(connection.key);
  }

  private requestDependencies(request: RequestDescriptor): Set<string> {
    const dependencies = new Set<string>();
    for (const item of request.items) {
      if (item.kind === 'node' || item.kind === 'nodes') {
        for (const id of item.ids) {
          dependencies.add(`entity:${toEntityId(item.type, id)}`);
        }
      } else if (item.kind === 'query') {
        dependencies.add(`root:${item.queryKey}`);
        const entityId = this.rootRequests.get(item.queryKey);
        if (entityId) {
          dependencies.add(`entity:${entityId}`);
        }
      } else if (item.kind === 'value') {
        dependencies.add(`root:${item.queryKey}`);
      } else if (item.kind === 'list') {
        dependencies.add(`list:${item.listKey}`);
      }
    }
    return dependencies;
  }

  private updateRequestListenerDependencies(listener: () => void) {
    const entry = this.requestListeners.get(listener);
    if (!entry) {
      return;
    }
    const next = this.requestDependencies(entry.descriptor);
    for (const dependency of entry.dependencies) {
      if (!next.has(dependency)) {
        const listeners = this.requestListenersByDependency.get(dependency);
        listeners?.delete(listener);
        if (!listeners?.size) {
          this.requestListenersByDependency.delete(dependency);
        }
      }
    }
    for (const dependency of next) {
      if (!entry.dependencies.has(dependency)) {
        let listeners = this.requestListenersByDependency.get(dependency);
        if (!listeners) {
          listeners = new Set();
          this.requestListenersByDependency.set(dependency, listeners);
        }
        listeners.add(listener);
      }
    }
    entry.dependencies = next;
  }

  private notifyRequests(dependencies: Iterable<string>) {
    for (const dependency of dependencies) {
      for (const listener of this.requestListenersByDependency.get(dependency) ?? []) {
        this.pendingRequestListeners.add(listener);
      }
    }
    if (this.pendingRequestListeners.size === 0) {
      return;
    }
    if (this.requestNotificationScheduled) {
      return;
    }
    this.requestNotificationScheduled = true;
    queueMicrotask(() => {
      this.requestNotificationScheduled = false;
      const listeners = [...this.pendingRequestListeners];
      this.pendingRequestListeners.clear();
      for (const listener of listeners) {
        this.updateRequestListenerDependencies(listener);
        if (!this.requestListeners.has(listener)) {
          continue;
        }
        listener();
      }
    });
  }

  private markCacheOnly(value: unknown): void {
    if (!value || typeof value !== 'object' || this.cacheOnlyRefs.has(value)) {
      return;
    }
    this.cacheOnlyRefs.add(value);
    for (const child of Object.values(value)) {
      this.markCacheOnly(child);
    }
  }

  private cacheOnlyResult<T>(value: T): T {
    if (!value || typeof value !== 'object') {
      return value;
    }
    const cached = this.cacheOnlyCopies.get(value);
    if (cached) {
      return cached as T;
    }
    if (ViewsTag in value) {
      const copy = Object.create(
        Object.getPrototypeOf(value),
        Object.getOwnPropertyDescriptors(value),
      );
      this.cacheOnlyCopies.set(value, copy);
      this.cacheOnlyRefs.add(copy);
      return copy as T;
    }
    if (Array.isArray(value)) {
      const copy = value.map((child) => this.cacheOnlyResult(child));
      this.cacheOnlyCopies.set(value, copy);
      return copy as T;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return value;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const descriptor of Object.values(descriptors)) {
      if ('value' in descriptor) {
        descriptor.value = this.cacheOnlyResult(descriptor.value);
      }
    }
    const copy = Object.create(Object.prototype, descriptors);
    this.cacheOnlyCopies.set(value, copy);
    return copy;
  }

  private cacheOnlyRequestResult<T extends AnyRecord>(request: RequestDescriptor, data: T): T {
    const cached = this.cacheOnlyCopies.get(data);
    if (cached) {
      return cached as T;
    }
    const copy = Object.fromEntries(
      request.items.map((item) => [
        item.name,
        // Value roots are opaque payloads, not containers of normalized view refs.
        item.kind === 'value' ? data[item.name] : this.cacheOnlyResult(data[item.name]),
      ]),
    );
    this.cacheOnlyCopies.set(data, copy);
    return copy as T;
  }

  /** Observes complete request results without throwing or suspending on a cache miss. */
  observeRequest<R extends Request>(
    request: R,
    options: RequestStateOptions = {},
  ): RequestObserver<RequestResult<Roots, R>> {
    const descriptor = this.createRequestDescriptor(request);
    return createRequestObserver({
      options,
      read: () => {
        if (!this.hasRequestData(descriptor)) {
          return undefined;
        }
        const data = this.getRequestResultFromDescriptor(descriptor) as RequestResult<Roots, R>;
        return options.mode === 'cache-only' ? this.cacheOnlyRequestResult(descriptor, data) : data;
      },
      retain: () => this.retain(request),
      start: (refresh) =>
        this.requestWithDescriptor(
          descriptor,
          refresh || options.mode === 'stale-while-revalidate'
            ? 'network-only'
            : options.mode === 'cache-only'
              ? 'cache-first'
              : (options.mode ?? 'cache-first'),
          { revalidateExisting: true },
          { persist: options.persist, signal: options.signal, timeout: options.timeout },
        ),
      subscribe: (listener) => this.subscribeRequestDescriptor(descriptor, listener),
    });
  }

  private subscribeRequestDescriptor(descriptor: RequestDescriptor, listener: () => void) {
    this.requestListeners.set(listener, { dependencies: new Set(), descriptor });
    this.updateRequestListenerDependencies(listener);
    return () => {
      const entry = this.requestListeners.get(listener);
      this.requestListeners.delete(listener);
      this.pendingRequestListeners.delete(listener);
      for (const dependency of entry?.dependencies ?? []) {
        const listeners = this.requestListenersByDependency.get(dependency);
        listeners?.delete(listener);
        if (!listeners?.size) {
          this.requestListenersByDependency.delete(dependency);
        }
      }
    };
  }

  /** @internal Observes result identities without starting work or restricting view refs. */
  observeRequestResult<R extends Request>(request: R) {
    const descriptor = this.createRequestDescriptor(request);
    return {
      getSnapshot: () => this.getRequestResultFromDescriptor(descriptor) as RequestResult<Roots, R>,
      subscribe: (listener: () => void) => this.subscribeRequestDescriptor(descriptor, listener),
    };
  }

  request<const R extends Request>(
    request: CheckedRequest<Roots, R>,
    options?: RequestOptions,
  ): Promise<RequestResult<Roots, R>> {
    const mode = options?.mode ?? 'cache-first';
    return this.requestWithDescriptor(
      this.createRequestDescriptor(request),
      mode,
      {
        revalidateExisting: true,
      },
      options,
    );
  }

  requestForRender<R extends Request>(
    request: R,
    options?: RequestOptions,
  ): Promise<RequestResult<Roots, R>> {
    return this.prepareRequestForRender(request, options).promise;
  }

  prepareRequestForRender<R extends Request>(
    request: R,
    options: RequestOptions | undefined,
  ): Readonly<{ promise: Promise<RequestResult<Roots, R>>; requestKey: string }> {
    const mode = options?.mode ?? 'cache-first';
    const descriptor = this.createRequestDescriptor(request);

    return {
      promise: this.requestWithDescriptor(descriptor, mode, { revalidateExisting: false }, options),
      requestKey: this.requestCacheKey(descriptor, options),
    };
  }

  private readonly readRequests = new SharedReads<void>();
  private readonly signalKeys = new WeakMap<AbortSignal, number>();
  private nextSignalKey = 0;
  private readonly controlledRequestKeys = new Map<string, Set<string>>();

  private requestCacheKey(descriptor: RequestDescriptor, options?: RequestOptions) {
    if (options?.timeout === undefined && !options?.signal) {
      return descriptor.key;
    }
    let signalKey = 0;
    if (options.signal) {
      signalKey = this.signalKeys.get(options.signal) ?? ++this.nextSignalKey;
      this.signalKeys.set(options.signal, signalKey);
    }
    return JSON.stringify(['controlled', descriptor.key, options.timeout, signalKey]);
  }

  private requestWithDescriptor<R extends Request>(
    descriptor: RequestDescriptor,
    mode: RequestMode,
    { revalidateExisting }: { revalidateExisting: boolean },
    options?: RequestOptions,
  ): Promise<RequestResult<Roots, R>> {
    this.assertPersistenceActive();
    const persistence = this.persistenceRuntime;
    if (
      persistence &&
      options?.persist &&
      (!Number.isSafeInteger(options.persist.maxAge) ||
        options.persist.maxAge < 0 ||
        options.persist.maxAge > Number.MAX_SAFE_INTEGER - Date.now())
    ) {
      throw new Error('fate: Persistence maxAge must be a non-negative finite duration.');
    }
    validateTimeout(options?.timeout);
    const controlled = options?.timeout !== undefined || options?.signal !== undefined;
    const cacheHandle = !controlled || !revalidateExisting;
    const requestKey = this.requestCacheKey(descriptor, options);
    const existingRequest = cacheHandle ? this.requests.get(requestKey)?.get(mode) : undefined;
    if (existingRequest) {
      if (persistence && options?.persist) {
        const executionOptions = this.requestExecutionOptions.get(existingRequest.descriptor);
        if (executionOptions) {
          executionOptions.persist = { ...options.persist };
        }
      }
      if (persistence && options?.persist && existingRequest.status === 'fulfilled') {
        persistence.used(existingRequest.descriptor, options.persist);
      }
      const isFulfilledCacheFirstWithMissingData =
        mode === 'cache-first' &&
        existingRequest.status === 'fulfilled' &&
        !this.hasRequestData(existingRequest.descriptor);

      if (
        existingRequest.status !== 'pending' &&
        (isFulfilledCacheFirstWithMissingData ||
          (revalidateExisting &&
            (mode === 'network-only' ||
              mode === 'stale-while-revalidate' ||
              (mode === 'cache-first' && existingRequest.status === 'rejected'))))
      ) {
        this.executeRequestHandle(existingRequest, mode, options);
      }

      return existingRequest as unknown as Promise<RequestResult<Roots, R>>;
    }

    const handle = new FateRequestPromise<RequestResult<Roots, Request>, RequestDescriptor>(
      descriptor,
      () => this.getRequestResultFromDescriptor(descriptor),
    );

    if (!cacheHandle) {
      this.executeRequestHandle(handle, mode, options);
      return handle as unknown as Promise<RequestResult<Roots, R>>;
    }
    if (controlled) {
      let keys = this.controlledRequestKeys.get(descriptor.key);
      if (!keys) {
        keys = new Set();
        this.controlledRequestKeys.set(descriptor.key, keys);
      }
      keys.add(requestKey);
    }
    let requests = this.requests.get(requestKey);
    if (!requests) {
      requests = new Map();
      this.requests.set(requestKey, requests);
    }

    requests.set(mode, handle);
    this.executeRequestHandle(handle, mode, options);

    return handle as unknown as Promise<RequestResult<Roots, R>>;
  }

  releaseRequest(request: Request, mode: RequestMode): void {
    const key = this.createRequestDescriptor(request).key;
    this.releaseRequestKey(key, mode);
    for (const controlledKey of this.controlledRequestKeys.get(key) ?? []) {
      this.releaseRequestKey(controlledKey, mode);
    }
  }

  releaseRequestKey(requestKey: string, mode: RequestMode): void {
    const requests = this.requests.get(requestKey);
    if (!requests) {
      return;
    }

    const descriptor = requests.get(mode)?.descriptor;
    requests.delete(mode);
    if (requests.size === 0 && descriptor) {
      const keys = this.controlledRequestKeys.get(descriptor.key);
      keys?.delete(requestKey);
      if (!keys?.size) {
        this.controlledRequestKeys.delete(descriptor.key);
      }
    }
    if (requests.size === 0) {
      this.requests.delete(requestKey);
    }
  }

  retainRequestKey(requestKey: string, mode?: RequestMode): RetainHandle {
    const requests = this.requests.get(requestKey);
    const descriptor =
      (mode ? requests?.get(mode)?.descriptor : undefined) ??
      requests?.values().next().value?.descriptor;

    return descriptor
      ? this.operationLifetime.retain(descriptor, () => this.scheduleGarbageCollection())
      : { dispose: emptyDispose };
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
    if (
      this.persistence
        ? this.store.hasTransientOptimisticUpdates
        : this.hasActiveOptimisticUpdates()
    ) {
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

    const optimisticRoots = this.store.getOptimisticRoots();
    optimisticRoots.baseRecords.forEach((record) => this.markRecordReferences(record, markRecord));
    optimisticRoots.records.forEach(markRecord);
    optimisticRoots.lists.forEach(markList);
    for (const { list } of this.mutationLists.values()) {
      markList(list.key);
      if (!list.root) {
        markRecord(list.owner);
      }
    }

    const retainedValueKeys = new Set<string>();
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

        if (item.kind === 'value') {
          retainedValueKeys.add(item.queryKey);
          continue;
        }

        if (item.kind === 'list') {
          markList(item.listKey);
          retainedValueKeys.add(`list:${item.listKey}`);
        }
      }
    }

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
      const entityId = queue[queueIndex];
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
        this.stableRefs.delete(id);
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

    for (const key of this.rootValues.keys()) {
      if (!retainedValueKeys.has(key)) {
        this.rootValues.delete(key);
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
    options?: RequestOptions,
  ) {
    const persistence = this.persistenceRuntime;
    const control = readControl(options);
    let background = false;
    const executionOptions = {
      fetchAll: mode !== 'cache-first',
      persist: options?.persist ? { ...options.persist } : undefined,
      signal: control?.signal,
    };
    if (persistence) {
      this.requestExecutionOptions.set(handle.descriptor, executionOptions);
    }
    const execute = (): Promise<RequestResult<Roots, Request>> => {
      this.assertPersistenceActive();
      control?.signal.throwIfAborted();
      if (mode === 'stale-while-revalidate' && this.hasRequestData(handle.descriptor)) {
        background = true;
        void this.executeRequest(handle.descriptor, executionOptions).then(
          () => {
            control?.dispose();
            this.notifyRequests(this.requestDependencies(handle.descriptor));
          },
          () => {
            control?.dispose();
            this.notifyRequests(this.requestDependencies(handle.descriptor));
          },
        );
        return Promise.resolve(this.getRequestResultFromDescriptor(handle.descriptor));
      }
      return this.executeRequest(handle.descriptor, executionOptions).then(() =>
        this.getRequestResultFromDescriptor(handle.descriptor),
      );
    };
    const execution = persistence
      ? this.withPersistenceLifecycle(() =>
          persistence.ready
            .then(() => {
              control?.signal.throwIfAborted();
              return mode === 'network-only'
                ? undefined
                : persistence.restoreRequest(handle.descriptor);
            })
            .then(execute),
        )
      : control?.signal.aborted
        ? Promise.reject(control.signal.reason)
        : execute();
    handle.start(
      abortable(execution, control?.signal).then(
        (result) => {
          if (!background) {
            control?.dispose();
          }
          for (const key of [
            handle.descriptor.key,
            ...(this.controlledRequestKeys.get(handle.descriptor.key) ?? []),
          ]) {
            const requests = this.requests.get(key);
            for (const [mode, previous] of requests ?? []) {
              if (previous.status === 'rejected') {
                this.releaseRequestKey(key, mode);
              }
            }
          }
          return result;
        },
        (error) => {
          if (!background) {
            control?.dispose();
          }
          throw error;
        },
      ),
    );
    void handle.then(
      () => this.notifyRequests(this.requestDependencies(handle.descriptor)),
      () => this.notifyRequests(this.requestDependencies(handle.descriptor)),
    );
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
    return this.store.hasOptimisticUpdates || this.pendingOptimisticMutations.size > 0;
  }

  private hasPendingRequests(): boolean {
    return this.pendingNetworkRequests > 0;
  }

  /** @internal */
  async withPersistenceLifecycle<T>(request: () => Promise<T>): Promise<T> {
    this.assertPersistenceActive();
    const signal = this.persistenceDisposal?.signal;
    let onDispose: (() => void) | undefined;
    try {
      const execution = request();
      const result = signal
        ? await Promise.race([
            execution,
            new Promise<never>((_, reject) => {
              onDispose = () => reject(new Error('fate: Persistence was disposed.'));
              signal.addEventListener('abort', onDispose, { once: true });
              if (signal.aborted) {
                onDispose();
              }
            }),
          ])
        : await execution;
      this.assertPersistenceActive();
      return result;
    } finally {
      if (onDispose) {
        signal?.removeEventListener('abort', onDispose);
      }
    }
  }

  async trackPendingRequest<T>(request: () => Promise<T>): Promise<T> {
    return this.withPersistenceLifecycle(async () => {
      if (this.persistence) {
        await this.persistence.ready;
      }
      this.assertPersistenceActive();
      this.pendingNetworkRequests += 1;
      try {
        return await this.withPersistenceLifecycle(request);
      } finally {
        this.pendingNetworkRequests -= 1;
        if (!this.pendingNetworkRequests) {
          this.writeVersions.clear();
        }
        this.persistenceRuntime?.changed();
      }
    });
  }

  private runPendingGarbageCollection() {
    if (this.gcPending && !this.hasActiveOptimisticUpdates()) {
      this.gc();
    }
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

  getRequestKey(request: Request): string {
    return this.createRequestDescriptor(request).key;
  }

  private missingForSelection(
    entityId: EntityId,
    paths: Iterable<string>,
    plan: SelectionPlan,
  ): Set<string> {
    const selection = expandRefetchSelection(this.types, parseEntityId(entityId).type, paths);
    const storagePaths = new Map([...selection].map((path) => [getStoragePath(path, plan), path]));
    return new Set(
      [...this.store.missingForSelection(entityId, storagePaths.keys())].map((path) =>
        storagePaths.get(path)!,
      ),
    );
  }

  private hasRootListData(item: ListRequestDescriptor): boolean {
    if (this.rootValues.has(`list:${item.listKey}`)) {
      return true;
    }
    const listState = this.store.getListState(item.listKey);
    if (!listState) {
      return false;
    }

    const paginationArgs = getPaginationArgsInfo(item.argsPayload);
    if (
      !paginationArgs.hasCursorArg &&
      !hasConnectionPageCoverage(listState, item.argsPayload, paginationArgs.direction)
    ) {
      return false;
    }

    for (const id of listState.ids) {
      if (this.missingForSelection(id, item.plan.paths, item.plan).size > 0) {
        return false;
      }
    }

    return true;
  }

  private executeRequest(
    request: RequestDescriptor,
    options: { fetchAll?: boolean; persist?: { maxAge: number }; signal?: AbortSignal } = {},
  ) {
    return this.readRequests.run(
      JSON.stringify([request.key, !!options.fetchAll, options.persist?.maxAge]),
      (signal) => this.executeRequestWork(request, options, signal),
      options.signal,
    );
  }

  private async executeRequestWork(
    request: RequestDescriptor,
    options: { fetchAll?: boolean; persist?: { maxAge: number } } = {},
    signal?: AbortSignal,
  ) {
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
    const fetchedItems: Array<RequestDescriptor['items'][number]> = [];
    let fetchedAll = true;
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

        const fetchedIds: Array<string | number> = [];
        for (const raw of item.ids) {
          const entityId = toEntityId(item.type, raw);
          const missing = this.missingForSelection(entityId, fields, item.plan);
          if (fetchAll || missing.size > 0) {
            group.ids.push(raw);
            fetchedIds.push(raw);
          }
        }
        if (fetchedIds.length) {
          fetchedItems.push({ ...item, ids: fetchedIds });
        }
        fetchedAll &&= fetchedIds.length === item.ids.length;
      } else {
        if (item.kind === 'value') {
          if (fetchAll || !this.rootValues.has(item.queryKey)) {
            promises.push(this.fetchValue(item, signal));
            fetchedItems.push(item);
          } else {
            fetchedAll = false;
          }
          continue;
        }

        if (item.kind === 'query') {
          const hasResult = this.rootRequests.has(item.queryKey);
          const entityId = this.rootRequests.get(item.queryKey);
          const missing =
            hasResult && entityId
              ? this.missingForSelection(entityId, item.plan.paths, item.plan)
              : item.plan.paths;

          if (fetchAll || !hasResult || (entityId && missing.size > 0)) {
            promises.push(this.fetchQueryAndNormalize(item, signal));
            fetchedItems.push(item);
          } else {
            fetchedAll = false;
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
          fetchedAll = false;
          continue;
        }
        promises.push(this.fetchListAndNormalize(item, signal));
        fetchedItems.push(item);
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
              null,
              signal,
            )
          : Promise.resolve(),
      ),
    ]);
    const persistence = this.persistenceRuntime;
    if (persistence) {
      if (fetchedItems.length) {
        // Only a successful fetch can renew the data it actually requested.
        persistence.fetched(
          fetchedAll
            ? request
            : {
                items: fetchedItems,
                key: `partial:${JSON.stringify([
                  request.key,
                  fetchedItems.map((item) => [item.name, 'ids' in item ? item.ids : null]),
                ])}`,
              },
          options.persist,
        );
      }
      if (!fetchedItems.length || !fetchedAll) {
        persistence.used(request, options.persist);
      }
    }
  }

  private hasRequestData(request: RequestDescriptor): boolean {
    for (const item of request.items) {
      if (item.kind === 'node' || item.kind === 'nodes') {
        const fields = item.plan.paths;
        for (const raw of item.ids) {
          const entityId = toEntityId(item.type, raw);
          const missing = this.missingForSelection(entityId, fields, item.plan);
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
            ? this.missingForSelection(entityId, item.plan.paths, item.plan)
            : item.plan.paths;
        if (!hasResult || (entityId && missing.size > 0)) {
          return false;
        }
        continue;
      }

      if (item.kind === 'value') {
        if (!this.rootValues.has(item.queryKey)) {
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
    const previous = this.requestResults.get(request);
    let result: AnyRecord = previous ?? {};
    for (const item of request.items) {
      const value = this.getRequestItemResult(item);
      if (!previous || !Object.is(previous[item.name], value)) {
        if (result === previous) {
          result = { ...previous };
        }
        result[item.name] = value;
      }
    }
    if (result !== previous) {
      this.requestResults.set(request, result);
    }
    return result as RequestResult<Roots, Request>;
  }

  private getRequestItemResult(item: RequestItemDescriptor): unknown {
    if (item.kind === 'node') {
      return this.stableRefWithViewNames(item.type, item.ids[0], item.refViewNames);
    }
    if (item.kind === 'query') {
      const entityId = this.rootRequests.get(item.queryKey);
      return entityId
        ? this.stableRefWithViewNames(item.type, parseEntityId(entityId).id, item.refViewNames)
        : null;
    }
    if (item.kind === 'value') {
      return this.rootValues.get(item.queryKey);
    }
    if (item.kind === 'list' && this.rootValues.has(`list:${item.listKey}`)) {
      return null;
    }

    const listState = item.kind === 'list' ? this.store.getListState(item.listKey) : undefined;
    // These containers depend only on immutable descriptor IDs or normalized list
    // state. Entity field changes are observed by views through their stable refs.
    const source = item.kind === 'nodes' ? item.ids : listState;
    const cached = this.requestItemResults.get(item);
    if (cached && Object.is(cached.source, source)) {
      return cached.value;
    }

    let value: unknown;
    if (item.kind === 'nodes') {
      value = item.ids.map((id) => this.stableRefWithViewNames(item.type, id, item.refViewNames));
    } else if (item.kind === 'list') {
      const entries = getListEntries(listState);
      const nodes = entries.map(({ id }) => {
        const { id: rawId, type } = parseEntityId(id);
        return this.stableRefWithViewNames(type, rawId, item.nodeRefViewNames);
      });
      if (item.hasItems) {
        const connection: AnyRecord = {
          items: nodes.map((node, index) => ({ cursor: entries[index]?.cursor, node })),
          pagination: listState?.pagination,
        };
        const metadata: ConnectionMetadata = {
          args: item.argsPayload,
          field: item.procedure,
          key: item.listKey,
          live: item.plan.live.get(''),
          owner: item.name,
          procedure: item.procedure,
          root: true,
          type: item.type,
        };
        value = this.exposeListTarget(connection, metadata);
      } else {
        value = this.exposeListTarget(nodes, {
          args: item.argsPayload,
          field: item.procedure,
          key: item.listKey,
          owner: item.name,
          procedure: item.procedure,
          root: true,
          type: item.type,
        });
      }
    }
    this.requestItemResults.set(item, { source, value });
    return value;
  }

  private readonly entityRefetches = new SharedReads<EntityFetchResult>();

  private async fetchEntities(
    type: string,
    ids: Array<string | number>,
    select: Iterable<string>,
    generation: number,
    args?: AnyRecord,
    signal?: AbortSignal,
  ): Promise<Array<EntityFetchResult>> {
    const config = this.getTypeConfig(type);
    const selection = expandRefetchSelection(this.types, type, select);
    if (!config.refetch) {
      const records = await abortable(
        signal
          ? this.transport.fetchById(type, ids, selection, args, { signal })
          : this.transport.fetchById(type, ids, selection, args),
        signal,
      );
      return records.map((record) => ({ generation, record }));
    }
    const recipe = config.refetch;
    if (!this.transport.fetchQuery) {
      throw new Error(`fate: Refetching '${type}' requires transport.fetchQuery.`);
    }
    const selectionSignature = JSON.stringify([...selection].sort());
    const fieldArgsSignature = args ? hashArgs(args) : '';
    return Promise.all(
      ids.map(async (id) => {
        const entityId = toEntityId(type, id);
        const locator = resolveRefetchArgs(
          recipe,
          this.store.readConfirmed(entityId)?.record,
          type,
        );
        for (const key of Object.keys(locator)) {
          if (args && Object.hasOwn(args, key)) {
            throw new Error(
              `fate: Refetch argument '${key}' conflicts with selected field arguments. Use a field alias.`,
            );
          }
        }
        const requestArgs = { ...args, ...locator };
        const key = JSON.stringify([
          entityId,
          recipe.root,
          hashArgs(locator),
          fieldArgsSignature,
          selectionSignature,
        ]);
        return this.entityRefetches.run(
          key,
          async (signal) => {
            const record = await abortable(
              this.transport.fetchQuery!(recipe.root, selection, requestArgs, {
                refetch: type,
                ...(signal ? { signal } : {}),
              }),
              signal,
            );
            signal?.throwIfAborted();
            this.assertPersistenceActive();
            if (record == null) {
              throw new FateRequestError(
                'NOT_FOUND',
                `fate: Refetch query '${recipe.root}' did not find '${entityId}'. Refresh its parent query to recover the locator.`,
              );
            }
            if (
              !isRecord(record) ||
              (record.__typename != null && record.__typename !== type) ||
              toEntityId(type, config.getId(record)) !== entityId
            ) {
              throw new Error(
                `fate: Refetch query '${recipe.root}' returned a different entity for '${entityId}'.`,
              );
            }
            return { generation, record };
          },
          signal,
        );
      }),
    );
  }

  private async fetchByIdAndNormalize(
    type: string,
    ids: Array<string | number>,
    select: Set<string>,
    plan?: SelectionPlan,
    prefix: string | null = null,
    signal?: AbortSignal,
  ) {
    const resolvedArgs = resolvedArgsFromPlan(plan);
    const generation = ++this.writeGeneration;
    await this.trackPendingRequest(async () => {
      const records = await this.fetchEntities(type, ids, select, generation, resolvedArgs, signal);
      signal?.throwIfAborted();
      this.assertPersistenceActive();
      for (const { generation, record } of records) {
        this.withWriteGeneration(generation, () =>
          this.writeEntity(type, record as AnyRecord, select, plan, prefix),
        );
      }
    });
  }

  private async fetchQueryAndNormalize(item: QueryRequestDescriptor, signal?: AbortSignal) {
    if (!this.transport.fetchQuery) {
      throw new Error(
        `fate: transport does not support queries. Please add support for 'fetchQuery' in your transport for '${item.name}'.`,
      );
    }

    const generation = ++this.writeGeneration;
    await this.trackPendingRequest(async () => {
      const record = await abortable(
        this.transport.fetchQuery!(
          item.procedure,
          expandRefetchSelection(this.types, item.type, item.plan.paths),
          item.argsPayload,
          ...(signal ? [{ signal }] : []),
        ),
        signal,
      );
      signal?.throwIfAborted();
      this.assertPersistenceActive();
      if (!record || typeof record !== 'object') {
        if (this.acceptWrite(`root:${item.queryKey}`, generation)) {
          this.rootRequests.set(item.queryKey, null);
        }
        return;
      }

      const entityId = this.withWriteGeneration(generation, () =>
        this.writeEntity(item.type, record as AnyRecord, item.plan.paths, item.plan),
      );
      if (this.acceptWrite(`root:${item.queryKey}`, generation)) {
        this.rootRequests.set(item.queryKey, entityId);
      }
    });
  }

  private async fetchValue(item: ValueRequestDescriptor, signal?: AbortSignal) {
    if (!this.transport.fetchQuery) {
      throw new Error(`fate: transport does not support value queries for '${item.name}'.`);
    }
    const generation = ++this.writeGeneration;
    await this.trackPendingRequest(async () => {
      const value = await abortable(
        this.transport.fetchQuery!(
          item.procedure,
          expandRefetchSelection(this.types, item.type, item.plan.paths),
          item.argsPayload,
          ...(signal ? [{ signal }] : []),
        ),
        signal,
      );
      signal?.throwIfAborted();
      this.assertPersistenceActive();
      if (this.acceptWrite(`root:${item.queryKey}`, generation)) {
        this.rootValues.set(item.queryKey, value);
      }
    });
  }

  private async fetchListAndNormalize(item: ListRequestDescriptor, signal?: AbortSignal) {
    if (!this.transport.fetchList) {
      throw new Error(
        `fate: 'transport.fetchList' is not configured but request includes a list for key '${item.name}'.`,
      );
    }

    const generation = ++this.writeGeneration;
    await this.trackPendingRequest(async () => {
      const connection = await abortable(
        this.transport.fetchList!(
          item.procedure,
          expandRefetchSelection(this.types, item.type, item.plan.paths),
          item.argsPayload,
          ...(signal ? [{ signal }] : []),
        ),
        signal,
      );
      signal?.throwIfAborted();
      this.assertPersistenceActive();
      const acceptList = this.acceptWrite(`list:${item.listKey}`, generation);
      if (connection === null) {
        if (acceptList) {
          this.rootValues.set(`list:${item.listKey}`, null);
        }
        return;
      }
      if (acceptList) {
        this.rootValues.delete(`list:${item.listKey}`);
      }
      const { items, pagination } = connection;
      this.withWriteGeneration(generation, () =>
        this.store.update(() => {
          const ids: Array<EntityId> = [];
          const cursors: Array<string | undefined> = [];
          for (const entry of items) {
            const id = this.writeEntity(
              item.type,
              entry.node as AnyRecord,
              item.plan.paths,
              item.plan,
            );
            ids.push(id);
            cursors.push(entry.cursor);
          }
          if (!acceptList) {
            return;
          }
          if (!filterConnectionArgs(item.argsPayload)) {
            this.registerRootList(item.type, item.listKey);
          }

          const previous = this.store.getListState(item.listKey);
          this.store.setList(
            item.listKey,
            this.mergeListState(previous, ids, cursors, pagination, {
              ...getPaginationMergeInfo(item.argsPayload),
              replace: true,
            }),
          );
        }),
      );
    });
  }

  private normalizeEmbedded(
    value: unknown,
    previous: unknown,
    paths: ReadonlySet<string>,
    plan: SelectionPlan | undefined,
    prefix: string,
    storagePrefix: string,
    replacedPaths: Set<string>,
  ): unknown {
    if (paths.size === 0) {
      if (isRecord(previous) || Array.isArray(previous)) {
        replacedPaths.add(storagePrefix);
      }
      return reuseNormalizedField(value, previous);
    }
    if (Array.isArray(value)) {
      replacedPaths.add(storagePrefix);
      return value.map((item) =>
        this.normalizeEmbedded(item, undefined, paths, plan, prefix, storagePrefix, replacedPaths),
      );
    }
    if (!isRecord(value)) {
      if (isRecord(previous) || Array.isArray(previous)) {
        replacedPaths.add(storagePrefix);
      }
      return reuseNormalizedField(value, previous);
    }
    const existing = isRecord(previous) ? previous : undefined;
    if (!existing) {
      replacedPaths.add(storagePrefix);
    }
    const children = groupSelectionByPrefix(paths);
    const result = { ...existing };
    for (const key of new Set([
      ...Object.keys(value),
      ...[...paths].map((path) => path.split('.')[0]),
    ])) {
      const path = `${prefix}.${key}`;
      const storageKey = getFieldKey(path, plan);
      result[storageKey] = this.normalizeEmbedded(
        value[key],
        existing?.[storageKey],
        children.get(key) ?? emptySet,
        plan,
        path,
        `${storagePrefix}.${storageKey}`,
        replacedPaths,
      );
    }
    return existing &&
      Object.keys(result).length === Object.keys(existing).length &&
      Object.keys(result).every((key) => Object.is(result[key], existing[key]))
      ? existing
      : result;
  }

  private writeEntity(
    type: string,
    record: AnyRecord,
    select: ReadonlySet<string>,
    plan?: SelectionPlan,
    pathPrefix: string | null = null,
    insert?: InsertPosition,
    selections: NormalizationSelections = new Map(),
  ): EntityId {
    return this.store.update(() => {
      type = this.relatedEntityType(type, this.types.get(type)?.possibleTypes, record);
      const config = this.types.get(type);
      if (!config) {
        throw new Error(`fate: Found unknown entity type '${type}' in normalization.`);
      }

      const id = config.getId(record);
      const entityId = toEntityId(type, id);
      const generation = this.applyingGeneration ?? ++this.writeGeneration;
      if (
        !this.store.isRecordingOptimistic &&
        (this.writeVersions.get(JSON.stringify([entityId])) ?? 0) > generation
      ) {
        return entityId;
      }
      const result: AnyRecord = {};
      const replacedPaths = new Set<string>();
      let normalized = selections.get(select)?.get(type);
      if (!normalized) {
        const expanded = expandRefetchSelection(this.types, type, select);
        const paths = expanded === select ? select : new Set(expanded);
        normalized = { children: groupSelectionByPrefix(paths), paths, storagePaths: new Map() };
        let byType = selections.get(select);
        if (!byType) {
          byType = new Map();
          selections.set(select, byType);
        }
        byType.set(type, normalized);
      }
      const expandedSelection = normalized.paths;
      if (expandedSelection.size !== select.size) {
        select = new Set(
          [...expandedSelection].filter(
            (path) => select.has(path) || path.includes('.') || Object.hasOwn(record, path),
          ),
        );
      }
      const selectionTree = normalized.children;

      const fields = Object.fromEntries(
        Object.keys(record).map((key) => [key, config.fields?.[schemaField(key)]]),
      );
      if (config.fields) {
        for (const [key, relationDescriptor] of Object.entries(fields)) {
          if (!relationDescriptor) {
            continue;
          }
          const value = record[key];
          const fieldPath = pathPrefix ? `${pathPrefix}.${key}` : key;
          const fieldArgs = plan?.args.get(fieldPath);
          const storageKey = getFieldKey(fieldPath, plan);
          if (!Object.hasOwn(record, key)) {
            continue;
          }
          const acceptField = this.acceptWrite(JSON.stringify([entityId, storageKey]), generation);
          if (relationDescriptor === 'scalar') {
            if (!acceptField) {
              continue;
            }
            result[storageKey] = reuseNormalizedField(
              value,
              this.store.read(entityId)?.[storageKey],
            );
          } else if (
            relationDescriptor &&
            typeof relationDescriptor === 'object' &&
            'type' in relationDescriptor
          ) {
            const childPaths = selectionTree.get(key) ?? emptySet;
            if (value === null) {
              if (acceptField) {
                result[storageKey] = null;
              }
              continue;
            }
            if (value && typeof value === 'object' && !isNodeRef(value)) {
              const childType = this.relatedEntityType(
                relationDescriptor.type,
                relationDescriptor.possibleTypes,
                value as AnyRecord,
              );
              const childConfig = this.types.get(childType);
              if (!childConfig) {
                throw new Error(
                  `fate: Unknown related type '${childType}' (field '${type}.${key}').`,
                );
              }
              const childId = toEntityId(childType, childConfig.getId(value));
              if (acceptField) {
                result[storageKey] = reuseNormalizedField(
                  createNodeRef(childId),
                  this.store.read(entityId)?.[storageKey],
                );
              }

              this.writeEntity(
                childType,
                value as AnyRecord,
                childPaths,
                plan,
                fieldPath,
                undefined,
                selections,
              );
            }
          } else if (
            relationDescriptor &&
            typeof relationDescriptor === 'object' &&
            'listOf' in relationDescriptor
          ) {
            const childPaths = selectionTree.get(key) ?? emptySet;
            if (value === null) {
              if (acceptField) {
                result[storageKey] = null;
              }
              continue;
            }
            const childType = relationDescriptor.listOf;
            if (!this.types.has(childType)) {
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
              const ids: Array<EntityId> = [];
              const cursors: Array<string | undefined> = [];

              const nodeSelection = [...childPaths].some(
                (path) => path.startsWith('items.') || path.startsWith('node.'),
              )
                ? new Set<string>()
                : childPaths;

              if (nodeSelection !== childPaths) {
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
                  const concreteType = this.relatedEntityType(
                    childType,
                    relationDescriptor.possibleTypes,
                    node as AnyRecord,
                  );
                  const childConfig = this.types.get(concreteType);
                  if (!childConfig) {
                    throw new Error(
                      `fate: Unknown related type '${concreteType}' (field '${type}.${key}').`,
                    );
                  }
                  const childId = toEntityId(concreteType, childConfig.getId(node as AnyRecord));

                  this.writeEntity(
                    concreteType,
                    node as AnyRecord,
                    nodeSelection,
                    plan,
                    fieldPath,
                    undefined,
                    selections,
                  );

                  ids.push(childId);
                  continue;
                }

                continue;
              }

              if (!acceptField) {
                continue;
              }

              const listKey = getListKey(entityId, schemaField(key), fieldArgs?.hash);
              const previousList = this.store.getListState(listKey);
              const argsValue = fieldArgs?.value as AnyRecord | undefined;

              const mergeInfo = getPaginationMergeInfo(argsValue);
              const pagination = connection.pagination as List['pagination'];
              const complete =
                Array.isArray(value) ||
                (mergeInfo.direction === 'forward'
                  ? pagination?.hasNext === false && pagination.hasPrevious !== true
                  : pagination?.hasPrevious === false && pagination.hasNext !== true);
              // Queries are authoritative windows. Mutations can return only a
              // partial page or extra unselected relations; retain loaded pages
              // unless the selected relation is a complete snapshot.
              const replace =
                !this.mutationWrite ||
                ((!this.mutationWrite.fields || this.mutationWrite.fields.has(fieldPath)) &&
                  complete);
              const nextListState = this.mergeListState(previousList, ids, cursors, pagination, {
                ...mergeInfo,
                replace,
              });

              const listChanged = !areListStatesEqual(previousList, nextListState);
              result[storageKey] = createNodeRefsForIds(
                nextListState.pendingBeforeIds?.length || nextListState.pendingAfterIds?.length
                  ? getListEntries(nextListState).map(({ id }) => id)
                  : nextListState.ids,
                this.store.read(entityId)?.[storageKey],
                {
                  reuseCurrentArray: !listChanged,
                },
              );

              this.store.setList(listKey, nextListState);
            }
          } else {
            if (acceptField) {
              result[storageKey] = this.normalizeEmbedded(
                value,
                this.store.read(entityId)?.[storageKey],
                selectionTree.get(key) ?? emptySet,
                plan,
                fieldPath,
                storageKey,
                replacedPaths,
              );
            }
          }
        }
      }

      for (const [key, value] of Object.entries(record)) {
        if (!fields[key]) {
          const fieldPath = pathPrefix ? `${pathPrefix}.${key}` : key;
          const storageKey = getFieldKey(fieldPath, plan);
          if (this.acceptWrite(JSON.stringify([entityId, storageKey]), generation)) {
            result[storageKey] = reuseNormalizedField(
              value,
              this.store.read(entityId)?.[storageKey],
            );
          }
        }
      }

      const selectedPaths: Array<string> = [];
      const prefix = pathPrefix ?? '';
      let storagePaths = normalized.storagePaths.get(prefix);
      if (!storagePaths) {
        storagePaths = [...expandedSelection].map((path) => {
          const storagePath = getStoragePath(path, plan, prefix);
          return {
            path,
            recordKey: path.split('.')[0],
            storageKey: storagePath.split('.')[0],
            storagePath,
          };
        });
        normalized.storagePaths.set(prefix, storagePaths);
      }
      for (const { path, recordKey, storageKey, storagePath } of storagePaths) {
        if (!select.has(path)) {
          continue;
        }
        // JSON omits selected undefined fields; they still have coverage unless
        // a newer write has superseded this response.
        if (
          Object.hasOwn(result, storageKey) ||
          (!Object.hasOwn(record, recordKey) &&
            this.acceptWrite(JSON.stringify([entityId, storageKey]), generation))
        ) {
          selectedPaths.push(storagePath);
        }
      }

      this.withWriteGeneration(generation, () =>
        this.store.merge(entityId, result, selectedPaths, replacedPaths),
      );
      this.linkParentLists(type, entityId, result, insert ?? 'none');
      if (!pathPrefix && insert) {
        this.insertIntoRootLists(type, entityId, insert);
      }
      return entityId;
    });
  }

  private linkParentLists(
    type: string,
    entityId: EntityId,
    record: AnyRecord,
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
          this.store.setList(defaultListKey, nextDefaultListState);
        }

        const nextFieldIds = pending
          ? getListEntries(nextDefaultListState).map(({ id }) => id)
          : nextDefaultListState.ids;
        nextField = createNodeRefsForIds(nextFieldIds, current);
      } else {
        const currentIds = current
          .map((item) => (isNodeRef(item) ? getNodeRefId(item) : null))
          .filter((id): id is EntityId => id != null);
        const ids = insert === 'before' ? [entityId, ...currentIds] : [...currentIds, entityId];
        const nextDefaultListState = { ids } satisfies List;

        this.store.setList(defaultListKey, nextDefaultListState);
        nextField = createNodeRefsForIds(nextDefaultListState.ids, current);
      }

      const registeredLists = this.store
        .getListsForField(parentId, parent.field)
        .filter(([key]) => key !== defaultListKey);

      for (const [listKey, listState] of registeredLists) {
        const nextListState = this.applyListInsert(listState, entityId, insert).list;
        if (nextListState === listState) {
          continue;
        }

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
      for (const [key, conditionalSelection] of Object.entries(viewPayload)) {
        const rawSelection = resolveConditionalSelection(conditionalSelection);
        if (rawSelection === undefined) {
          target[key] = undefined;
          continue;
        }
        if (isAliasedView(rawSelection)) {
          aliasedField(key, key);
          const { id, type } = parseEntityId(parentId);
          const namedRef = this.stableRefWithViewNames(
            type,
            parentId === entityId ? ref.id : id,
            getViewNames(rawSelection.view),
          );
          target[key] = this.cacheOnlyRefs.has(ref) ? this.cacheOnlyResult(namedRef) : namedRef;
          continue;
        }
        const selectionKind = isAliasedSelection(rawSelection)
          ? rawSelection.selection
          : rawSelection;
        const field = isAliasedSelection(rawSelection) ? rawSelection.field : key;
        const pathField = isAliasedSelection(rawSelection) ? aliasedField(key, field) : key;
        if (isViewTag(key)) {
          if (!target[ViewsTag]) {
            assignViewTag(target, new Set());
          }

          addViewName(target[ViewsTag]!, key, rawSelection as ViewPayload<any, any>);
          continue;
        }

        const fieldPath = prefix ? `${prefix}.${pathField}` : pathField;
        const storageKey = getFieldKey(fieldPath, plan);
        if (isDeferredSelection(selectionKind)) {
          const { id, type } = parseEntityId(parentId);
          coverageById.set(parentId, (coverageById.get(parentId) ?? new Set()).add(storageKey));
          const deferred = createDeferred({
            field,
            id,
            owner: parentId,
            selection: getDeferredSelection(selectionKind),
            type,
          });
          this.deferredTargets.add(deferred);
          target[key] = deferred;
          continue;
        }

        coverageById.set(parentId, (coverageById.get(parentId) ?? new Set()).add(storageKey));

        const selectionType = typeof selectionKind;
        if (selectionType === 'boolean' && selectionKind) {
          const value = record[storageKey];
          const metadata = Array.isArray(value)
            ? this.nestedListMetadata(parentId, field, plan, fieldPath)
            : undefined;
          target[key] =
            metadata && Array.isArray(value) ? this.exposeListTarget([...value], metadata) : value;
        } else if (selectionKind && selectionType === 'object') {
          const selectionValue = selectionKind as AnyRecord;
          const { args: selectionArgs, ...selectionWithoutArgs } = selectionValue;
          const hasArgsOnly =
            Boolean(selectionArgs) &&
            typeof selectionArgs === 'object' &&
            Object.keys(selectionWithoutArgs).length === 0;

          if (hasArgsOnly) {
            const value = record[storageKey];
            const metadata = Array.isArray(value)
              ? this.nestedListMetadata(parentId, field, plan, fieldPath)
              : undefined;
            target[key] =
              metadata && Array.isArray(value)
                ? this.exposeListTarget([...value], metadata)
                : value;
            continue;
          }

          if (!(key in target)) {
            target[key] = {};
          }

          const nextSelection = Object.keys(selectionWithoutArgs).length
            ? selectionWithoutArgs
            : selectionValue;

          const value = record[storageKey];

          if (value == null) {
            target[key] = null;
            continue;
          }

          if (Array.isArray(value)) {
            if (nextSelection.items && typeof nextSelection.items === 'object') {
              const selection = nextSelection.items as AnyRecord;
              const fieldArgs = plan.args.get(fieldPath);
              const listKey = getListKey(parentId, field, fieldArgs?.hash);
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
              const metadata = this.nestedListMetadata(parentId, field, plan, fieldPath);
              target[key] = metadata ? this.exposeListTarget(connection, metadata) : connection;
            } else {
              const items = value.map((item) => {
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
              const metadata = this.nestedListMetadata(parentId, field, plan, fieldPath);
              target[key] = metadata ? this.exposeListTarget(items, metadata) : items;
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

    const payloads = getViewPayloads(viewComposition, ref);
    if (payloads.length === 0 && isRecord(viewComposition)) {
      walk(viewComposition, record, data, entityId, pathPrefix);
    } else {
      for (const viewPayload of payloads) {
        walk(viewPayload.select, record, data, entityId, pathPrefix);
      }
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

  private deferredPendingKey(
    entityId: EntityId,
    fields: ReadonlySet<string>,
    plan: SelectionPlan,
    selectionSignature: string,
  ) {
    const args = [...plan.args.entries()]
      .map(([path, entry]) => `${path}:${entry.hash}`)
      .sort()
      .join('|');
    return `${this.pendingKey(entityId, new Set(fields))}|${args}|${selectionSignature}`;
  }

  private deferredSelectionSignature(selection: unknown) {
    const seen = new Set<object>();

    const serialize = (value: unknown): string => {
      if (value === null || typeof value !== 'object') {
        return `${typeof value}:${String(value)}`;
      }

      if (seen.has(value)) {
        return '[Circular]';
      }

      seen.add(value);

      if (Array.isArray(value)) {
        return `[${value.map((item) => serialize(item)).join(',')}]`;
      }

      const entries = Object.entries(value as AnyRecord)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => (isViewTag(key) ? `view:${key}` : `${key}:${serialize(entry)}`));

      return `{${entries.join(',')}}`;
    };

    return serialize(selection);
  }

  private hasMissingDeferredList(
    owner: EntityId,
    type: string,
    field: string,
    plan: SelectionPlan,
  ) {
    const descriptor = this.types.get(type)?.fields?.[field];
    if (!descriptor || descriptor === 'scalar' || !('listOf' in descriptor)) {
      return false;
    }

    const fieldArgs = plan.args.get(field);
    // A confirmed null relation has no list state and needs no page fetch.
    if (this.store.read(owner)?.[argumentFieldKey(field, fieldArgs?.hash)] === null) {
      return false;
    }
    const listState = this.store.getListState(getListKey(owner, field, fieldArgs?.hash));
    if (!listState) {
      return true;
    }

    const args = fieldArgs?.value as AnyRecord | undefined;
    const paginationArgs = getPaginationArgsInfo(args);
    if (paginationArgs.hasCursorArg) {
      return true;
    }

    return !hasConnectionPageCoverage(listState, args, paginationArgs.direction);
  }

  private liveSubscriptionKey(entityId: EntityId, plan: SelectionPlan) {
    const paths = [...plan.paths].sort().join('|');
    const args = [...plan.args.entries()]
      .map(([path, entry]) => `${path}:${entry.hash}`)
      .sort()
      .join('|');
    return `${entityId}|${paths}|${args}`;
  }

  private liveConnectionSubscriptionKey(
    connection: ConnectionMetadata,
    plan: SelectionPlan,
    args: Record<string, unknown> | undefined,
  ) {
    const paths = [...plan.paths].sort().join('|');
    const selectionArgs = [...plan.args.entries()]
      .map(([path, entry]) => `${path}:${entry.hash}`)
      .sort()
      .join('|');
    return `connection|${connection.procedure}|${connection.type}|${hashArgs(args ?? {})}|${paths}|${selectionArgs}`;
  }

  private releaseLiveSubscription(key: string) {
    const subscription = this.liveSubscriptions.get(key);
    if (!subscription) {
      return;
    }

    if (subscription.count <= 0) {
      return;
    }

    subscription.count -= 1;
    if (subscription.count > 0) {
      return;
    }

    subscription.releaseScheduled = true;
    queueMicrotask(() => {
      const current = this.liveSubscriptions.get(key);
      if (!current || !current.releaseScheduled || current.count > 0) {
        return;
      }

      current.unsubscribe();
      this.liveSubscriptions.delete(key);
    });
  }

  private reportLiveError(error: unknown) {
    const onLiveError = this.onLiveError;
    if (!onLiveError) {
      return;
    }

    queueMicrotask(() => {
      onLiveError(error);
    });
  }
}

export function createClient<
  T extends [FateRoots, FateMutations] = [
    Record<never, RootDefinition<any, any>>,
    Record<never, MutationDefinition<any, any, any>>,
  ],
  HydrationScope extends string = string,
>(options: FateClientOptions<T[0], T[1], HydrationScope>) {
  return new FateClient<T[0], T[1], HydrationScope>(options);
}
