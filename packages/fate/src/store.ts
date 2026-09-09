import ViewDataCache from './cache.ts';
import {
  cloneMask,
  diffPaths,
  emptyMask,
  FieldMask,
  fromPaths,
  intersects,
  isCovered,
  toPaths,
  union,
} from './mask.ts';
import { getNodeRefId, isNodeRef } from './node-ref.ts';
import type { AnyRecord, EntityId, Pagination } from './types.ts';

export type List = Readonly<{
  backwardPageLimit?: number;
  cursors?: ReadonlyArray<string | undefined>;
  forwardPageLimit?: number;
  ids: ReadonlyArray<EntityId>;
  liveAfterIds?: ReadonlyArray<EntityId>;
  liveBeforeIds?: ReadonlyArray<EntityId>;
  pagination?: Pagination;
  pendingAfterIds?: ReadonlyArray<EntityId>;
  pendingBeforeIds?: ReadonlyArray<EntityId>;
}>;

type Snapshot = { mask?: FieldMask; record?: AnyRecord };
type OptimisticWrite = { partial: AnyRecord; paths: Set<string> };

type OptimisticLayer = {
  apply: () => void;
  durable?: boolean;
  settled?: boolean;
  writes: Map<EntityId, OptimisticWrite>;
};

type Snapshots = {
  lists: Map<string, List | undefined>;
  records: Map<EntityId, Snapshot>;
};

type Subscription = Readonly<{ fn: () => void; mask: FieldMask | null }>;

export type Subscriptions = Map<EntityId, Set<Subscription>>;

export type StoreHydrationState = Readonly<{
  coverage: ReadonlyArray<readonly [EntityId, ReadonlyArray<string>]>;
  lists: ReadonlyArray<readonly [string, List]>;
  records: ReadonlyArray<readonly [EntityId, AnyRecord]>;
}>;

export type StoreChange =
  | Readonly<{ key: string; kind: 'list'; previousList?: List }>
  | Readonly<{
      key: EntityId;
      kind: 'record';
      paths?: Iterable<string>;
      referencesChanged: boolean;
    }>;

const listKeySeparator = ' __fate__ ';

type ListKeyParts = Readonly<{ field: string; ownerId: EntityId }>;

const decodeListKeyPart = (part: string): string => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

const encodeListKeyPart = (part: string): string => encodeURIComponent(part);

export const getListKey = (ownerId: EntityId, field: string, hash = 'default'): string =>
  `${encodeListKeyPart(ownerId)}${listKeySeparator}${encodeListKeyPart(field)}${listKeySeparator}${encodeListKeyPart(hash)}`;

const getOwnerFieldKey = (ownerId: EntityId, field: string): string =>
  JSON.stringify([ownerId, field]);

const parseListKey = (key: string): ListKeyParts | null => {
  const parts = key.split(listKeySeparator);
  if (parts.length !== 3) {
    return null;
  }

  const [ownerId, field] = parts;

  return {
    field: decodeListKeyPart(field),
    ownerId: decodeListKeyPart(ownerId),
  };
};

const isPlainRecord = (value: unknown): value is AnyRecord => {
  if (value == null || typeof value !== 'object' || Array.isArray(value) || isNodeRef(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isDate = (value: unknown): value is Date =>
  value != null &&
  typeof value === 'object' &&
  Object.prototype.toString.call(value) === '[object Date]' &&
  typeof (value as Date).getTime === 'function';

export const mergePreservingExisting = (incoming: unknown, existing: unknown): unknown => {
  if (!isPlainRecord(incoming) || !isPlainRecord(existing)) {
    return existing;
  }

  const result: AnyRecord = Object.create(null);
  for (const [key, value] of Object.entries(incoming)) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  for (const [key, value] of Object.entries(existing)) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: Object.hasOwn(result, key) ? mergePreservingExisting(result[key], value) : value,
      writable: true,
    });
  }
  return result;
};

const areHydrationValuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }

  if (isNodeRef(left) || isNodeRef(right)) {
    return isNodeRef(left) && isNodeRef(right) && getNodeRefId(left) === getNodeRefId(right);
  }

  if (isDate(left) || isDate(right)) {
    return isDate(left) && isDate(right) && left.getTime() === right.getTime();
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => areHydrationValuesEqual(value, right[index]))
    );
  }

  if (!isPlainRecord(left) || !isPlainRecord(right)) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => Object.hasOwn(right, key) && areHydrationValuesEqual(left[key], right[key]),
    )
  );
};

const areMasksEqual = (left: FieldMask | undefined, right: FieldMask | undefined): boolean => {
  if (left === right || (left?.all && right?.all)) {
    return true;
  }
  if (!left || !right || left.all !== right.all || left.children.size !== right.children.size) {
    return false;
  }
  for (const [key, child] of left.children) {
    if (!areMasksEqual(child, right.children.get(key))) {
      return false;
    }
  }
  return true;
};

const emptyFunction = () => {};

const hasReferences = (value: unknown): boolean =>
  isNodeRef(value) || (Array.isArray(value) && value.some(isNodeRef));

// Normalization recreates relation references and arrays when a layer is replayed.
const areNormalizedValuesEqual = (left: unknown, right: unknown): boolean =>
  Object.is(left, right) ||
  (isNodeRef(left) && isNodeRef(right) && getNodeRefId(left) === getNodeRefId(right)) ||
  (Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => areNormalizedValuesEqual(value, right[index])));

export class Store {
  private coverage = new Map<EntityId, FieldMask>();
  private listKeysByOwnerField = new Map<string, Set<string>>();
  private listKeysByReferencedEntity = new Map<EntityId, Set<string>>();
  private lists = new Map<string, List>();
  private recordReferenceFields = new Map<EntityId, Map<string, Set<EntityId>>>();
  private recordReferencesByTarget = new Map<EntityId, Map<EntityId, Set<string>>>();
  private records = new Map<EntityId, AnyRecord>();
  private subscriptions: Subscriptions = new Map();
  private listSubscriptions = new Map<string, Set<() => void>>();

  private readonly optimisticLayers = new Set<OptimisticLayer>();
  private readonly optimisticBase: Snapshots = { lists: new Map(), records: new Map() };
  private recordingLayer: OptimisticLayer | undefined;
  private rebase: Snapshots | undefined;

  constructor(
    private readonly onRebase?: (ids: ReadonlySet<EntityId>) => void,
    private readonly onChange?: (change: StoreChange) => void,
  ) {}

  get hasOptimisticUpdates(): boolean {
    return this.optimisticLayers.size > 0;
  }

  get isRebasing(): boolean {
    return this.rebase !== undefined;
  }

  /** Apply a synchronous cache update beneath the pending optimistic layers. */
  update<T>(apply: () => T): T {
    if (this.rebase || this.optimisticLayers.size === 0) {
      return apply();
    }

    const rebase: Snapshots = { lists: new Map(), records: new Map() };
    this.rebase = rebase;
    try {
      // Undo the pending writes once to expose the authoritative state.
      for (const [id, snapshot] of this.optimisticBase.records) {
        this.restore(id, snapshot);
      }
      for (const [key, list] of this.optimisticBase.lists) {
        this.restoreList(key, list);
      }
      this.optimisticBase.records.clear();
      this.optimisticBase.lists.clear();
      return apply();
    } finally {
      try {
        for (const layer of this.optimisticLayers) {
          layer.writes.clear();
          this.recordingLayer = layer;
          layer.apply();
        }
      } finally {
        this.recordingLayer = undefined;
        const records = this.getRebaseChanges(rebase);
        const lists = new Set<string>();
        for (const [key, before] of rebase.lists) {
          if (!areHydrationValuesEqual(before, this.lists.get(key))) {
            lists.add(key);
            // Connection metadata belongs to its owner's view even when IDs match.
            const owner = parseListKey(key);
            if (owner) {
              if (!records.has(owner.ownerId)) {
                records.set(owner.ownerId, new Set([owner.field]));
              } else {
                records.get(owner.ownerId)?.add(owner.field);
              }
            }
          } else if (before) {
            this.lists.set(key, before);
          }
        }
        this.rebase = undefined;
        this.onRebase?.(new Set(records.keys()));
        for (const [id, paths] of records) {
          this.notify(id, paths, false);
        }
        for (const key of lists) {
          this.notifyListSubscribers(key, false);
        }
      }
    }
  }

  private getRebaseChanges(rebase: Snapshots): Map<EntityId, Set<string> | undefined> {
    const changes = new Map<EntityId, Set<string> | undefined>();
    for (const [id, before] of rebase.records) {
      const after = this.records.get(id);
      const mask = this.coverage.get(id);
      if (Boolean(before.record) !== Boolean(after) || before.mask?.all !== mask?.all) {
        changes.set(id, undefined);
        continue;
      }
      const paths = new Set<string>();
      for (const key of new Set([
        ...Object.keys(before.record ?? {}),
        ...Object.keys(after ?? {}),
      ])) {
        if (
          Object.hasOwn(before.record ?? {}, key) !== Object.hasOwn(after ?? {}, key) ||
          !areNormalizedValuesEqual(before.record?.[key], after?.[key])
        ) {
          paths.add(key);
        }
      }
      if (!areMasksEqual(before.mask, mask)) {
        for (const path of before.mask ? toPaths(before.mask) : []) {
          if (!mask || !isCovered(mask, path)) {
            paths.add(path);
          }
        }
        for (const path of mask ? toPaths(mask) : []) {
          if (!before.mask || !isCovered(before.mask, path)) {
            paths.add(path);
          }
        }
      }
      if (paths.size > 0) {
        changes.set(id, paths);
      } else if (before.record) {
        // Keep referential equality as well as suppressing redundant notifications.
        // Relation indexes already describe the same normalized IDs.
        this.records.set(id, before.record);
      }
    }
    return changes;
  }

  /** Returns an idempotent settlement function; omit its update to roll back. */
  optimisticUpdate(apply: () => void, durable = false): (commit?: () => void) => void {
    const layer: OptimisticLayer = { apply, durable, writes: new Map() };
    const settle = (commit?: () => void) => {
      if (!this.optimisticLayers.has(layer) || layer.settled) {
        return;
      }
      this.update(() => {
        // A newer completed mutation must not reveal an older pending value.
        // Keep only its overlapping optimistic fields visible until those older
        // operations finish; its complete server response still enters the base.
        const overlays = commit
          ? this.getPendingOverlap(layer, layer.writes)
          : new Map<EntityId, OptimisticWrite>();
        if (overlays.size > 0) {
          layer.settled = true;
          layer.apply = () => {
            for (const [id, { partial, paths }] of this.getPendingOverlap(layer, overlays)) {
              this.merge(id, partial, paths);
            }
          };
        } else {
          this.optimisticLayers.delete(layer);
        }
        for (const pending of this.optimisticLayers) {
          if (!pending.settled) {
            break;
          }
          this.optimisticLayers.delete(pending);
        }
        commit?.();
      });
    };
    this.optimisticLayers.add(layer);
    try {
      this.update(() => {});
    } catch (error) {
      settle();
      throw error;
    }
    return settle;
  }

  private getPendingOverlap(
    layer: OptimisticLayer,
    writes: ReadonlyMap<EntityId, OptimisticWrite>,
  ) {
    const earlier: Array<OptimisticLayer> = [];
    for (const pending of this.optimisticLayers) {
      if (pending === layer) {
        break;
      }
      if (!pending.settled) {
        earlier.push(pending);
      }
    }
    const overlaps = new Map<EntityId, OptimisticWrite>();
    for (const [id, write] of writes) {
      // Replaying relation references would resurrect resolved temporary IDs.
      const partial = Object.fromEntries(
        Object.entries(write.partial).filter(
          ([key, value]) =>
            !hasReferences(value) &&
            earlier.some(({ writes }) => {
              const previous = writes.get(id)?.partial;
              return previous && Object.hasOwn(previous, key) && !hasReferences(previous[key]);
            }),
        ),
      );
      if (Object.keys(partial).length) {
        overlaps.set(id, {
          partial,
          paths: new Set(
            [...write.paths].filter((path) => Object.hasOwn(partial, path.split('.')[0])),
          ),
        });
      }
    }
    return overlaps;
  }

  private captureRecord(id: EntityId) {
    if (!this.rebase) {
      return;
    }
    for (const target of [this.rebase, this.recordingLayer && this.optimisticBase]) {
      if (target && !target.records.has(id)) {
        const mask = this.coverage.get(id);
        target.records.set(id, {
          mask: mask ? cloneMask(mask) : undefined,
          record: this.records.get(id),
        });
      }
    }
  }

  private captureList(key: string) {
    if (!this.rebase) {
      return;
    }
    for (const target of [this.rebase, this.recordingLayer && this.optimisticBase]) {
      if (target && !target.lists.has(key)) {
        target.lists.set(key, this.lists.get(key));
      }
    }
  }

  get hasTransientOptimisticUpdates(): boolean {
    return [...this.optimisticLayers].some((layer) => !layer.durable);
  }

  getOptimisticRoots() {
    return {
      baseRecords: [...this.optimisticBase.records.values()].flatMap(({ record }) =>
        record ? [record] : [],
      ),
      lists: [...this.optimisticBase.lists.keys()],
      records: [
        ...this.optimisticBase.records.keys(),
        ...[...this.optimisticBase.lists.values()].flatMap((list) =>
          list
            ? [
                ...list.ids,
                ...(list.pendingBeforeIds ?? []),
                ...(list.pendingAfterIds ?? []),
                ...(list.liveBeforeIds ?? []),
                ...(list.liveAfterIds ?? []),
              ]
            : [],
        ),
      ],
    };
  }

  /** @internal Indexed owners needed for mutation rollback. */
  getPersistenceOwners(id: EntityId) {
    return {
      lists: [...(this.listKeysByReferencedEntity.get(id) ?? [])],
      records: [...(this.recordReferencesByTarget.get(id)?.keys() ?? [])],
    };
  }

  /** @internal Read one confirmed record without copying the cache. */
  readConfirmed(id: EntityId) {
    const snapshot = this.optimisticBase.records.get(id);
    const record = snapshot ? snapshot.record : this.records.get(id);
    const mask = snapshot ? snapshot.mask : this.coverage.get(id);
    return record ? { paths: mask ? toPaths(mask) : [], record } : undefined;
  }

  /** @internal */
  readConfirmedList(key: string) {
    return this.optimisticBase.lists.has(key)
      ? this.optimisticBase.lists.get(key)
      : this.lists.get(key);
  }

  dehydrateConfirmed(): StoreHydrationState {
    const records = new Map(this.records);
    const coverage = new Map(this.coverage);
    const lists = new Map(this.lists);
    for (const [id, snapshot] of this.optimisticBase.records) {
      if (snapshot.record === undefined) {
        records.delete(id);
      } else {
        records.set(id, snapshot.record);
      }
      if (snapshot.mask === undefined) {
        coverage.delete(id);
      } else {
        coverage.set(id, snapshot.mask);
      }
    }
    for (const [key, list] of this.optimisticBase.lists) {
      if (list === undefined) {
        lists.delete(key);
      } else {
        lists.set(key, list);
      }
    }
    return {
      coverage: [...coverage].map(([id, mask]) => [id, toPaths(mask)]),
      lists: [...lists],
      records: [...records],
    };
  }

  dehydrate(): StoreHydrationState {
    return {
      coverage: [...this.coverage].map(([id, mask]) => [id, toPaths(mask)]),
      lists: [...this.lists],
      records: [...this.records],
    };
  }

  hydrate(
    state: StoreHydrationState,
    mode: 'preserve-existing' | 'replace',
    options: { deferNotifications?: boolean } = {},
  ) {
    const previousCoverage = this.coverage;
    const previousLists = this.lists;
    const previousRecords = this.records;
    const coverage =
      mode === 'replace'
        ? new Map<EntityId, FieldMask>()
        : new Map([...previousCoverage].map(([id, mask]) => [id, cloneMask(mask)]));
    const lists = mode === 'replace' ? new Map<string, List>() : new Map(previousLists);
    const records = mode === 'replace' ? new Map<EntityId, AnyRecord>() : new Map(previousRecords);

    for (const [id, incoming] of state.records) {
      const previous = records.get(id);
      const next =
        previous && mode === 'preserve-existing'
          ? (mergePreservingExisting(incoming, previous) as AnyRecord)
          : incoming;
      records.set(id, previous && areHydrationValuesEqual(previous, next) ? previous : next);
    }

    for (const [id, paths] of state.coverage) {
      const incoming = fromPaths(paths);
      const previous = coverage.get(id);
      if (previous && mode === 'preserve-existing') {
        union(previous, incoming);
      } else {
        coverage.set(id, incoming);
      }
    }

    for (const [key, list] of state.lists) {
      const previous = lists.get(key);
      if (mode === 'replace' || !previous) {
        lists.set(key, previous && areHydrationValuesEqual(previous, list) ? previous : list);
      }
    }

    this.coverage = coverage;
    this.lists = lists;
    this.records = records;
    this.rebuildIndexes();

    const changedRecordIds = new Set<EntityId>();
    const changedRecordReferences = new Set<EntityId>();
    for (const id of new Set([...previousRecords.keys(), ...records.keys()])) {
      if (
        !areHydrationValuesEqual(previousRecords.get(id), records.get(id)) ||
        !areMasksEqual(previousCoverage.get(id), coverage.get(id))
      ) {
        changedRecordIds.add(id);
        if (this.recordReferencesChanged(previousRecords.get(id), records.get(id))) {
          changedRecordReferences.add(id);
        }
      }
    }
    const changedListKeys = new Set<string>();
    for (const key of new Set([...previousLists.keys(), ...lists.keys()])) {
      if (!areHydrationValuesEqual(previousLists.get(key), lists.get(key))) {
        changedListKeys.add(key);
      }
    }

    const notify = () => {
      for (const id of changedRecordIds) {
        this.notify(id, undefined, true, changedRecordReferences.has(id));
      }
      for (const key of changedListKeys) {
        this.notifyListSubscribers(key);
      }
    };

    if (!options.deferNotifications) {
      notify();
    }
    return notify;
  }

  private rebuildIndexes() {
    this.listKeysByOwnerField.clear();
    this.listKeysByReferencedEntity.clear();
    this.recordReferenceFields.clear();
    this.recordReferencesByTarget.clear();

    for (const [id, record] of this.records) {
      this.addRecordReferenceIndexes(id, record);
    }
    for (const [key, list] of this.lists) {
      this.addListIndexes(key, list);
    }
  }

  read(id: EntityId) {
    return this.records.get(id);
  }

  merge(id: EntityId, partial: AnyRecord, paths: Iterable<string>) {
    return this.update(() => {
      const change = this.mergeInternal(id, partial, paths);
      if (change) {
        this.notify(id, change.paths, true, change.referencesChanged);
      }
    });
  }

  private mergeInternal(
    id: EntityId,
    partial: AnyRecord,
    paths: Iterable<string>,
  ): { paths: ReadonlySet<string>; referencesChanged: boolean } | null {
    this.captureRecord(id);
    const selectedPaths = this.recordingLayer ? new Set(paths) : paths;
    if (this.recordingLayer) {
      const write = this.recordingLayer.writes.get(id) ?? { partial: {}, paths: new Set<string>() };
      Object.assign(write.partial, partial);
      for (const path of selectedPaths) {
        write.paths.add(path);
      }
      this.recordingLayer.writes.set(id, write);
    }
    const previous = this.records.get(id);
    const changedPaths = new Set<string>();

    let mask = this.coverage.get(id);
    if (!mask) {
      mask = emptyMask();
      this.coverage.set(id, mask);
    }

    union(mask, fromPaths(selectedPaths));

    if (previous) {
      let hasChanges = false;
      for (const [key, value] of Object.entries(partial)) {
        if (previous[key] !== value) {
          hasChanges = true;
          changedPaths.add(key);
        }
      }

      if (!hasChanges) {
        return null;
      }

      const nextRecord = { ...previous, ...partial };
      const referencesChanged = this.recordReferencesChanged(previous, nextRecord, changedPaths);
      this.records.set(id, nextRecord);
      this.updateRecordReferenceIndexes(id, previous, nextRecord, changedPaths);
      return { paths: changedPaths, referencesChanged };
    } else {
      const nextRecord = { ...partial };
      this.records.set(id, nextRecord);
      this.updateRecordReferenceIndexes(id, undefined, nextRecord, Object.keys(nextRecord));
      return {
        paths: changedPaths,
        referencesChanged: this.recordReferencesChanged(undefined, nextRecord),
      };
    }
  }

  deleteRecord(id: EntityId) {
    return this.update(() => {
      this.captureRecord(id);
      const record = this.records.get(id);
      if (record) {
        this.removeRecordReferenceIndexes(id, record);
      }
      this.records.delete(id);
      this.coverage.delete(id);
      if (!this.recordingLayer) {
        this.onChange?.({ key: id, kind: 'record', referencesChanged: true });
      }
    });
  }

  missingForSelection(id: EntityId, paths: Iterable<string>): Set<string> {
    const requested = new Set(paths);
    if (!this.records.has(id)) {
      return requested;
    }
    const mask = this.coverage.get(id);
    if (!mask) {
      return requested;
    }
    return diffPaths(requested, mask);
  }

  subscribe(id: EntityId, selection: ReadonlySet<string> | null, fn: () => void): () => void;

  subscribe(id: EntityId, fn: () => void): () => void;

  subscribe(
    id: EntityId,
    selectionOrFn: ReadonlySet<string> | (() => void) | null,
    callback?: () => void,
  ): () => void {
    let mask: FieldMask | null = null;
    let fn = emptyFunction;

    if (typeof selectionOrFn === 'function') {
      fn = selectionOrFn;
    } else if (callback) {
      mask = selectionOrFn ? fromPaths(selectionOrFn) : null;
      fn = callback;
    }

    let subscribers = this.subscriptions.get(id);
    if (!subscribers) {
      subscribers = new Set();
      this.subscriptions.set(id, subscribers);
    }

    const subscription: Subscription = { fn, mask };
    subscribers.add(subscription);

    return () => {
      const set = this.subscriptions.get(id);
      if (!set) {
        return;
      }

      set.delete(subscription);
      if (set.size === 0) {
        this.subscriptions.delete(id);
      }
    };
  }

  private notify(
    id: EntityId,
    paths?: Iterable<string>,
    confirmed = true,
    referencesChanged = false,
  ) {
    if (confirmed && !this.recordingLayer) {
      this.onChange?.({ key: id, kind: 'record', paths, referencesChanged });
    }
    if (this.rebase) {
      return;
    }
    const set = this.subscriptions.get(id);
    if (!set) {
      return;
    }

    const changedPaths = paths ? [...paths] : [];
    const changedMask = changedPaths.length > 0 ? fromPaths(changedPaths) : null;

    for (const { fn, mask } of set) {
      if (mask && changedMask && !intersects(changedMask, mask)) {
        continue;
      }

      try {
        fn();
      } catch {
        /* empty */
      }
    }
  }

  private notifyListSubscribers(key: string, confirmed = true, previousList?: List) {
    if (confirmed && !this.recordingLayer) {
      this.onChange?.({ key, kind: 'list', previousList });
    }
    if (this.rebase) {
      return;
    }
    const set = this.listSubscriptions.get(key);
    if (!set) {
      return;
    }

    for (const fn of set) {
      try {
        fn();
      } catch {
        /* empty */
      }
    }
  }

  getList(key: string): ReadonlyArray<EntityId> | undefined {
    return this.lists.get(key)?.ids;
  }

  getListState(key: string): List | undefined {
    return this.lists.get(key);
  }

  getListsForField(ownerId: EntityId, field: string): Array<readonly [string, List]> {
    const entries: Array<readonly [string, List]> = [];
    const keys = this.listKeysByOwnerField.get(getOwnerFieldKey(ownerId, field));
    if (!keys) {
      return entries;
    }

    for (const key of keys) {
      const list = this.lists.get(key);
      if (list) {
        entries.push([key, list]);
      }
    }
    return entries;
  }

  setList(key: string, state: List) {
    return this.update(() => {
      this.captureList(key);
      const previous = this.lists.get(key);
      if (previous) {
        this.removeListIndexes(key, previous);
      }
      this.lists.set(key, state);
      this.addListIndexes(key, state);
      this.notifyListSubscribers(key, true, previous);
    });
  }

  replaceListEntityId(previousId: EntityId, nextId: EntityId) {
    return this.update(() => {
      const keys = [...(this.listKeysByReferencedEntity.get(previousId) ?? [])];
      for (const key of keys) {
        const list = this.lists.get(key);
        if (!list) {
          continue;
        }

        let changed = false;

        let ids = list.ids;
        let cursors = list.cursors;
        if (list.ids.includes(previousId)) {
          const nextIds: Array<EntityId> = [];
          const nextCursors = list.cursors ? ([] as Array<string | undefined>) : undefined;
          const seenIds = new Set<EntityId>();
          list.ids.forEach((id, index) => {
            const resolved = id === previousId ? nextId : id;
            if (seenIds.has(resolved)) {
              return;
            }
            seenIds.add(resolved);
            nextIds.push(resolved);
            if (nextCursors) {
              nextCursors.push(list.cursors?.[index]);
            }
          });
          changed = true;
          ids = nextIds;
          cursors = nextCursors;
        }

        const dedupe = (values: ReadonlyArray<EntityId> | undefined) => {
          if (!values || !values.includes(previousId)) {
            return undefined;
          }

          const seen = new Set<EntityId>();
          const next: Array<EntityId> = [];
          for (const value of values) {
            const resolved = value === previousId ? nextId : value;
            if (seen.has(resolved)) {
              continue;
            }
            seen.add(resolved);
            next.push(resolved);
          }

          changed = true;
          return next;
        };

        const pendingBeforeIds = dedupe(list.pendingBeforeIds) ?? list.pendingBeforeIds;
        const pendingAfterIds = dedupe(list.pendingAfterIds) ?? list.pendingAfterIds;
        const liveBeforeIds = dedupe(list.liveBeforeIds) ?? list.liveBeforeIds;
        const liveAfterIds = dedupe(list.liveAfterIds) ?? list.liveAfterIds;

        if (!changed) {
          continue;
        }

        const canonicalIds = new Set(ids);
        this.setList(key, {
          backwardPageLimit: list.backwardPageLimit,
          cursors,
          forwardPageLimit: list.forwardPageLimit,
          ids,
          liveAfterIds: liveAfterIds?.filter((id) => !canonicalIds.has(id)),
          liveBeforeIds: liveBeforeIds?.filter((id) => !canonicalIds.has(id)),
          pagination: list.pagination,
          pendingAfterIds: pendingAfterIds?.filter((id) => !canonicalIds.has(id)),
          pendingBeforeIds: pendingBeforeIds?.filter((id) => !canonicalIds.has(id)),
        });
      }
    });
  }

  restoreList(key: string, list?: List) {
    return this.update(() => {
      if (list == null) {
        this.deleteList(key);
      } else {
        this.setList(key, list);
      }
    });
  }

  collectGarbage(
    markedRecords: ReadonlySet<EntityId>,
    markedLists: ReadonlySet<string>,
    options: { onRecordDeleted?: (id: EntityId) => void } = {},
  ): { lists: Set<string>; records: Set<EntityId> } {
    const records = new Set<EntityId>();
    const lists = new Set<string>();

    for (const id of this.records.keys()) {
      if (markedRecords.has(id)) {
        continue;
      }

      records.add(id);
    }

    for (const key of this.lists.keys()) {
      if (markedLists.has(key)) {
        continue;
      }

      lists.add(key);
    }

    for (const id of records) {
      const record = this.records.get(id);
      if (record) {
        this.removeRecordReferenceIndexes(id, record);
      }
      this.records.delete(id);
      this.coverage.delete(id);
      options.onRecordDeleted?.(id);
    }

    for (const key of lists) {
      this.deleteList(key, true);
    }

    return { lists, records };
  }

  private deleteList(key: string, collected = false) {
    return this.update(() => {
      this.captureList(key);
      const previous = this.lists.get(key);
      if (previous) {
        this.removeListIndexes(key, previous);
      }
      this.lists.delete(key);
      this.notifyListSubscribers(key, !collected, previous);
    });
  }

  subscribeList(key: string, fn: () => void): () => void {
    let set = this.listSubscriptions.get(key);
    if (!set) {
      set = new Set();
      this.listSubscriptions.set(key, set);
    }

    set.add(fn);

    return () => {
      const subscribers = this.listSubscriptions.get(key);
      if (!subscribers) {
        return;
      }

      subscribers.delete(fn);
      if (subscribers.size === 0) {
        this.listSubscriptions.delete(key);
      }
    };
  }

  removeReferencesTo(targetId: EntityId, viewDataCache: ViewDataCache) {
    return this.update(() => {
      const listKeys = [...(this.listKeysByReferencedEntity.get(targetId) ?? [])];
      for (const key of listKeys) {
        const list = this.lists.get(key);
        if (!list) {
          continue;
        }

        const { ids } = list;
        const hasLiveAfter = Boolean(list.liveAfterIds?.includes(targetId));
        const hasLiveBefore = Boolean(list.liveBeforeIds?.includes(targetId));
        const hasPendingAfter = Boolean(list.pendingAfterIds?.includes(targetId));
        const hasPendingBefore = Boolean(list.pendingBeforeIds?.includes(targetId));
        if (
          !ids.includes(targetId) &&
          !hasLiveAfter &&
          !hasLiveBefore &&
          !hasPendingAfter &&
          !hasPendingBefore
        ) {
          continue;
        }

        const entityIds: Array<EntityId> = [];
        const cursors = list.cursors ? ([] as Array<string | undefined>) : undefined;

        for (let index = 0; index < ids.length; index++) {
          const id = ids[index];
          if (id === targetId) {
            continue;
          }

          entityIds.push(id);
          if (cursors) {
            cursors.push(list.cursors?.[index]);
          }
        }

        this.setList(key, {
          backwardPageLimit: list.backwardPageLimit,
          cursors,
          forwardPageLimit: list.forwardPageLimit,
          ids: entityIds,
          liveAfterIds: list.liveAfterIds?.filter((id) => id !== targetId),
          liveBeforeIds: list.liveBeforeIds?.filter((id) => id !== targetId),
          pagination: list.pagination,
          pendingAfterIds: list.pendingAfterIds?.filter((id) => id !== targetId),
          pendingBeforeIds: list.pendingBeforeIds?.filter((id) => id !== targetId),
        });
      }

      const ids = new Map<EntityId, Set<string>>();

      const recordEntries = [...(this.recordReferencesByTarget.get(targetId)?.entries() ?? [])];

      for (const [id, fields] of recordEntries) {
        const record = this.records.get(id);
        if (!record) {
          continue;
        }

        let updated = false;
        const next: AnyRecord = {};
        const paths = new Set<string>();

        for (const key of fields) {
          const value = record[key];
          if (Array.isArray(value)) {
            const filtered = value.filter(
              (item) => !(isNodeRef(item) && getNodeRefId(item) === targetId),
            );

            if (filtered.length !== value.length) {
              updated = true;
              paths.add(key);
              next[key] = filtered;
            }
          } else if (isNodeRef(value) && getNodeRefId(value) === targetId) {
            updated = true;
            paths.add(key);
            next[key] = null;
          }
        }

        if (!updated) {
          continue;
        }

        viewDataCache.invalidate(id);
        this.mergeInternal(id, next, paths);
        ids.set(id, paths);
      }

      for (const [id, paths] of ids) {
        this.notify(id, paths, true, true);
      }
    });
  }

  private restore(id: EntityId, snapshot: Snapshot) {
    return this.update(() => {
      this.captureRecord(id);
      const previous = this.records.get(id);
      if (previous) {
        this.removeRecordReferenceIndexes(id, previous);
      }

      if (snapshot.record === undefined) {
        this.records.delete(id);
      } else {
        this.records.set(id, snapshot.record);
        this.addRecordReferenceIndexes(id, snapshot.record);
      }

      if (snapshot.mask === undefined) {
        this.coverage.delete(id);
      } else {
        this.coverage.set(id, snapshot.mask);
      }

      // This only exposes the existing confirmed base before optimistic layers
      // are replayed. The authoritative write, if any, reports reference changes.
      this.notify(id);
    });
  }

  private addListIndexes(key: string, list: List) {
    const parsed = parseListKey(key);
    if (parsed) {
      const ownerFieldKey = getOwnerFieldKey(parsed.ownerId, parsed.field);
      let keys = this.listKeysByOwnerField.get(ownerFieldKey);
      if (!keys) {
        keys = new Set();
        this.listKeysByOwnerField.set(ownerFieldKey, keys);
      }
      keys.add(key);
    }

    for (const id of this.getListReferencedEntityIds(list)) {
      let keys = this.listKeysByReferencedEntity.get(id);
      if (!keys) {
        keys = new Set();
        this.listKeysByReferencedEntity.set(id, keys);
      }
      keys.add(key);
    }
  }

  private removeListIndexes(key: string, list: List) {
    const parsed = parseListKey(key);
    if (parsed) {
      const ownerFieldKey = getOwnerFieldKey(parsed.ownerId, parsed.field);
      const keys = this.listKeysByOwnerField.get(ownerFieldKey);
      if (keys) {
        keys.delete(key);
        if (keys.size === 0) {
          this.listKeysByOwnerField.delete(ownerFieldKey);
        }
      }
    }

    for (const id of this.getListReferencedEntityIds(list)) {
      const keys = this.listKeysByReferencedEntity.get(id);
      if (!keys) {
        continue;
      }

      keys.delete(key);
      if (keys.size === 0) {
        this.listKeysByReferencedEntity.delete(id);
      }
    }
  }

  private getListReferencedEntityIds(list: List): Set<EntityId> {
    const ids = new Set<EntityId>();
    for (const id of list.ids) {
      ids.add(id);
    }
    for (const id of list.liveAfterIds ?? []) {
      ids.add(id);
    }
    for (const id of list.liveBeforeIds ?? []) {
      ids.add(id);
    }
    for (const id of list.pendingAfterIds ?? []) {
      ids.add(id);
    }
    for (const id of list.pendingBeforeIds ?? []) {
      ids.add(id);
    }
    return ids;
  }

  private getRecordFieldReferences(value: unknown): Set<EntityId> | null {
    if (Array.isArray(value)) {
      let ids: Set<EntityId> | null = null;
      for (const item of value) {
        if (!isNodeRef(item)) {
          continue;
        }

        if (!ids) {
          ids = new Set();
        }
        ids.add(getNodeRefId(item));
      }
      return ids;
    }

    if (isNodeRef(value)) {
      return new Set([getNodeRefId(value)]);
    }

    return null;
  }

  private recordReferencesChanged(
    previous: AnyRecord | undefined,
    next: AnyRecord | undefined,
    fields: Iterable<string> = new Set([
      ...Object.keys(previous ?? {}),
      ...Object.keys(next ?? {}),
    ]),
  ) {
    for (const field of fields) {
      const before = this.getRecordFieldReferences(previous?.[field]);
      const after = this.getRecordFieldReferences(next?.[field]);
      if (before?.size !== after?.size) {
        return true;
      }
      if (before) {
        for (const id of before) {
          if (!after?.has(id)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private addRecordFieldReferenceIndex(id: EntityId, field: string, value: unknown) {
    const targets = this.getRecordFieldReferences(value);
    if (!targets || targets.size === 0) {
      return;
    }

    let fields = this.recordReferenceFields.get(id);
    if (!fields) {
      fields = new Map();
      this.recordReferenceFields.set(id, fields);
    }
    fields.set(field, targets);

    for (const targetId of targets) {
      let records = this.recordReferencesByTarget.get(targetId);
      if (!records) {
        records = new Map();
        this.recordReferencesByTarget.set(targetId, records);
      }

      let targetFields = records.get(id);
      if (!targetFields) {
        targetFields = new Set();
        records.set(id, targetFields);
      }
      targetFields.add(field);
    }
  }

  private removeRecordFieldReferenceIndex(id: EntityId, field: string) {
    const fields = this.recordReferenceFields.get(id);
    const targets = fields?.get(field);
    if (!fields || !targets) {
      return;
    }

    for (const targetId of targets) {
      const records = this.recordReferencesByTarget.get(targetId);
      const targetFields = records?.get(id);
      if (!records || !targetFields) {
        continue;
      }

      targetFields.delete(field);
      if (targetFields.size === 0) {
        records.delete(id);
      }
      if (records.size === 0) {
        this.recordReferencesByTarget.delete(targetId);
      }
    }

    fields.delete(field);
    if (fields.size === 0) {
      this.recordReferenceFields.delete(id);
    }
  }

  private addRecordReferenceIndexes(id: EntityId, record: AnyRecord) {
    for (const [field, value] of Object.entries(record)) {
      this.addRecordFieldReferenceIndex(id, field, value);
    }
  }

  private removeRecordReferenceIndexes(id: EntityId, record: AnyRecord) {
    for (const field of Object.keys(record)) {
      this.removeRecordFieldReferenceIndex(id, field);
    }
  }

  private updateRecordReferenceIndexes(
    id: EntityId,
    previous: AnyRecord | undefined,
    next: AnyRecord,
    fields: Iterable<string>,
  ) {
    for (const field of fields) {
      if (previous) {
        this.removeRecordFieldReferenceIndex(id, field);
      }
      this.addRecordFieldReferenceIndex(id, field, next[field]);
    }
  }
}
