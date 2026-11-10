import ViewDataCache from './cache.ts';
import { argumentFieldKey } from './field-key.ts';
import type { ListWindow } from './list.ts';
import {
  addPath,
  cloneMask,
  diffPaths,
  emptyMask,
  FieldMask,
  fromPaths,
  intersects,
  isCovered,
  isCoverageSelection,
  removePath,
  toPaths,
  union,
} from './mask.ts';
import { getNodeRefId, isNodeRef } from './node-ref.ts';
import { isDate } from './record.ts';
import {
  addIndexValue,
  appendIndexValue,
  copyIndexValues,
  indexValues,
  removeIndexValue,
  type IndexedValues,
  type ReferenceIndex,
} from './reference-index.ts';
import type { AnyRecord, EntityId, Pagination } from './types.ts';

export type List = Readonly<{
  acknowledgedInsertions?: ReadonlyArray<EntityId>;
  afterCursor?: string;
  backwardPageLimit?: number;
  beforeCursor?: string;
  cursors?: ReadonlyArray<string | undefined>;
  forwardPageLimit?: number;
  ids: ReadonlyArray<EntityId>;
  insertedAfterIds?: ReadonlyArray<EntityId>;
  insertedBeforeIds?: ReadonlyArray<EntityId>;
  liveAfterIds?: ReadonlyArray<EntityId>;
  liveBeforeIds?: ReadonlyArray<EntityId>;
  pagination?: Pagination;
  pendingAfterIds?: ReadonlyArray<EntityId>;
  pendingBeforeIds?: ReadonlyArray<EntityId>;
  stale?: true;
  /** Membership changes held before any server page has been fetched. */
  unloaded?: true;
  windows?: Readonly<Record<string, ListWindow>>;
}>;

type Snapshot = { mask?: FieldMask; record?: AnyRecord };
type OptimisticWrite = { partial: AnyRecord; paths: Set<string>; replacedPaths?: Set<string> };

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

export type StorePreview = {
  lists: Map<string, readonly [List | undefined, List | undefined]>;
  records: Map<EntityId, readonly [AnyRecord | undefined, AnyRecord | undefined]>;
};

type Subscription = Readonly<{ fn: () => void; mask: FieldMask | null }>;

export type Subscriptions = Map<EntityId, Set<Subscription>>;

export type StoreHydrationState = Readonly<{
  coverage: ReadonlyArray<readonly [EntityId, ReadonlyArray<string>]>;
  lists: ReadonlyArray<readonly [string, List]>;
  records: ReadonlyArray<readonly [EntityId, AnyRecord]>;
  stale?: ReadonlyArray<readonly [EntityId, ReadonlyArray<string>]>;
}>;

export type StoreChange =
  | Readonly<{ key: string; kind: 'list'; previousList?: List }>
  | Readonly<{
      invalidated?: true;
      key: EntityId;
      kind: 'record';
      patchPaths?: ReadonlySet<string>;
      paths?: Iterable<string>;
      referencesChanged: boolean;
    }>;

const listKeySeparator = ' __fate__ ';

type ListKeyParts = Readonly<{ field: string; hash?: string; ownerId: EntityId }>;

const decodeListKeyPart = (part: string): string => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

const encodeListKeyPart = (part: string): string => encodeURIComponent(part);

const listKeySuffix = (field: string, hash: string): string =>
  `${listKeySeparator}${encodeListKeyPart(field)}${listKeySeparator}${encodeListKeyPart(hash)}`;

export const getListKey = (ownerId: EntityId, field: string, hash = 'default'): string =>
  `${encodeListKeyPart(ownerId)}${listKeySuffix(field, hash)}`;

export const compileListKey = (field: string, hash = 'default') => {
  const suffix = listKeySuffix(field, hash);
  return (ownerId: EntityId): string => `${encodeListKeyPart(ownerId)}${suffix}`;
};

const getOwnerFieldKey = (ownerId: EntityId, field: string): string =>
  JSON.stringify([ownerId, field]);

export const parseListKey = (key: string): ListKeyParts | null => {
  const parts = key.split(listKeySeparator);
  if (parts.length !== 3) {
    return null;
  }

  const [ownerId, field, hash] = parts;

  return {
    field: decodeListKeyPart(field),
    hash: hash === 'default' ? undefined : decodeListKeyPart(hash),
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

/** Expand cached objects so a partial refresh can clear just the returned leaves. */
export const expandStalePaths = (record: AnyRecord, paths: Iterable<string>) => {
  const stale = new Set<string>();
  const ancestors = new Set<object>();
  const visit = (path: string, value: unknown) => {
    if (isPlainRecord(value) && !ancestors.has(value)) {
      const entries = Object.entries(value);
      if (entries.length && entries.every(([key]) => key && !key.includes('.'))) {
        ancestors.add(value);
        for (const [key, child] of entries) {
          visit(`${path}.${key}`, child);
        }
        ancestors.delete(value);
        return;
      }
    }
    stale.add(path);
  };
  for (const path of paths) {
    let value: unknown = record;
    for (const key of path.split('.')) {
      value = isPlainRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
    }
    visit(path, value);
  }
  return [...stale];
};

// Confirmed writes can carry a merged embedded object. Record which leaves
// actually changed so persistence can apply the write to another tab's value.
const collectRecordPatchPaths = (
  paths: Set<string>,
  before: unknown,
  after: unknown,
  path: string,
  selected: ReadonlyArray<string>,
  replaced: ReadonlyArray<string>,
) => {
  if (Object.is(before, after)) {
    return;
  }
  if (
    isPlainRecord(before) &&
    isPlainRecord(after) &&
    !replaced.includes(path) &&
    selected.some((entry) => entry.startsWith(`${path}.`))
  ) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      collectRecordPatchPaths(paths, before[key], after[key], `${path}.${key}`, selected, replaced);
    }
  } else {
    paths.add(path);
  }
};

export const mergePreservingExisting = (incoming: unknown, existing: unknown): unknown => {
  if (!isPlainRecord(incoming) || !isPlainRecord(existing)) {
    return existing;
  }

  const result: AnyRecord = Object.create(null);
  for (const [key, value] of Object.entries(incoming)) {
    result[key] = value;
  }
  for (const [key, value] of Object.entries(existing)) {
    result[key] = Object.hasOwn(result, key) ? mergePreservingExisting(result[key], value) : value;
  }
  return result;
};

export const areHydrationValuesEqual = (left: unknown, right: unknown): boolean => {
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

const areListIdsEqual = (
  left: ReadonlyArray<EntityId> | undefined,
  right: ReadonlyArray<EntityId> | undefined,
): boolean =>
  left === right ||
  (left?.length === right?.length && !!left && left.every((id, index) => id === right?.[index]));

export class Store {
  private coverage = new Map<EntityId, FieldMask>();
  private readonly stalePaths = new Map<EntityId, ReadonlyArray<string>>();
  private readonly sharedCoverage = new WeakMap<FieldMask, ReadonlyArray<string>>();
  private listKeysByOwnerField: ReferenceIndex = new Map();
  private listKeysByReferencedEntity: ReferenceIndex = new Map();
  private lists = new Map<string, List>();
  private recordReferenceFields = new Map<EntityId, ReferenceIndex>();
  private recordReferencesByTarget = new Map<EntityId, ReferenceIndex>();
  private records = new Map<EntityId, AnyRecord>();
  private subscriptions: Subscriptions = new Map();
  private listSubscriptions = new Map<string, Set<() => void>>();

  private readonly optimisticLayers = new Set<OptimisticLayer>();
  private readonly optimisticBase: Snapshots = { lists: new Map(), records: new Map() };
  private recordingLayer: OptimisticLayer | undefined;
  private rebase: Snapshots | undefined;

  constructor(
    private readonly onRebase?: (ids: ReadonlySet<EntityId>, lists: ReadonlySet<string>) => void,
    private readonly onChange?: (change: StoreChange, owner?: ListKeyParts | null) => void,
  ) {}

  private transactionSnapshots: Snapshots | undefined;
  private transactionStale: Map<EntityId, ReadonlyArray<string> | undefined> | undefined;
  private transactionChanges: Array<() => void> | undefined;
  private transactionSubscribers: Set<() => void> | undefined;
  private previewing = false;

  get isPreviewing() {
    return this.previewing;
  }

  /** Run a synchronous update without publishing it or retaining its changes. */
  preview<T>(apply: () => void, read: (changes: StorePreview) => T): T {
    if (this.transactionChanges) {
      throw new Error('fate: Cannot preview changes inside a store transaction.');
    }
    const baseRecords = new Map(this.optimisticBase.records);
    const baseLists = new Map(this.optimisticBase.lists);
    this.previewing = true;
    try {
      return this.transaction(() => {
        apply();
        const changes = this.transactionSnapshots!;
        return read({
          lists: new Map(
            [...changes.lists].map(([key, list]) => [
              key,
              [baseLists.has(key) ? baseLists.get(key) : list, this.readConfirmedList(key)],
            ]),
          ),
          records: new Map(
            [...changes.records].map(([id, { record }]) => [
              id,
              [
                baseRecords.has(id) ? baseRecords.get(id)?.record : record,
                this.confirmedRecord(id),
              ],
            ]),
          ),
        });
      });
    } finally {
      this.previewing = false;
    }
  }

  /** Publish a synchronous graph update atomically, restoring data if it throws. */
  transaction<T>(apply: () => T): T {
    if (this.transactionChanges) {
      return apply();
    }
    const snapshot: Snapshots = { lists: new Map(), records: new Map() };
    const stale = new Map<EntityId, ReadonlyArray<string> | undefined>();
    this.transactionSnapshots = snapshot;
    this.transactionStale = stale;
    const layers = [...this.optimisticLayers].map((layer) => ({
      apply: layer.apply,
      layer,
      settled: layer.settled,
      writes: new Map(layer.writes),
    }));
    const baseRecords = new Map(this.optimisticBase.records);
    const baseLists = new Map(this.optimisticBase.lists);
    const changes: Array<() => void> = [];
    const subscribers = new Set<() => void>();
    this.transactionChanges = changes;
    this.transactionSubscribers = subscribers;
    let result: T;
    let completed = false;
    try {
      result = apply();
      if (result && typeof result === 'object' && 'then' in result) {
        throw new Error('fate: Store transactions must be synchronous.');
      }
      completed = true;
    } finally {
      this.transactionSnapshots = undefined;
      this.transactionStale = undefined;
      this.transactionChanges = undefined;
      this.transactionSubscribers = undefined;
      if (!completed || this.previewing) {
        for (const [id, { mask, record }] of snapshot.records) {
          const current = this.records.get(id);
          if (current !== record) {
            if (current) {
              this.removeRecordReferenceIndexes(id, current);
            }
            if (record) {
              this.records.set(id, record);
              this.addRecordReferenceIndexes(id, record);
            } else {
              this.records.delete(id);
            }
          }
          if (mask) {
            this.coverage.set(id, mask);
          } else {
            this.coverage.delete(id);
          }
          const paths = stale.get(id);
          if (paths) {
            this.stalePaths.set(id, paths);
          } else {
            this.stalePaths.delete(id);
          }
        }
        for (const [key, list] of snapshot.lists) {
          const current = this.lists.get(key);
          if (current !== list) {
            if (current) {
              this.removeListIndexes(key, current);
            }
            if (list) {
              this.lists.set(key, list);
              this.addListIndexes(key, list);
            } else {
              this.lists.delete(key);
            }
          }
        }
        this.optimisticLayers.clear();
        for (const { apply, layer, settled, writes } of layers) {
          layer.apply = apply;
          layer.settled = settled;
          layer.writes = writes;
          this.optimisticLayers.add(layer);
        }
        this.optimisticBase.records = baseRecords;
        this.optimisticBase.lists = baseLists;
      }
    }
    if (this.previewing) {
      return result;
    }
    for (const change of changes) {
      change();
    }
    for (const subscriber of subscribers) {
      try {
        subscriber();
      } catch {
        /* Subscribers cannot undo a committed update. */
      }
    }
    return result;
  }

  private publishChange(change: StoreChange, owner?: ListKeyParts | null) {
    if (this.transactionChanges) {
      this.transactionChanges.push(() => this.onChange?.(change, owner));
    } else {
      this.onChange?.(change, owner);
    }
  }

  get hasOptimisticUpdates(): boolean {
    return this.optimisticLayers.size > 0;
  }

  /** @internal Whether a temporary optimistic layer is being replayed. */
  get isRecordingOptimistic(): boolean {
    return this.recordingLayer !== undefined;
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
        this.writeList(key, list, undefined, false);
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
                records.set(owner.ownerId, new Set([argumentFieldKey(owner.field, owner.hash)]));
              } else {
                records.get(owner.ownerId)?.add(argumentFieldKey(owner.field, owner.hash));
              }
            }
          } else if (before) {
            this.lists.set(key, before);
          }
        }
        this.rebase = undefined;
        if (!this.previewing) {
          this.onRebase?.(new Set(records.keys()), lists);
        }
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
            for (const [id, { partial, paths, replacedPaths }] of this.getPendingOverlap(
              layer,
              overlays,
            )) {
              this.merge(id, partial, paths, replacedPaths);
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
          replacedPaths:
            write.replacedPaths &&
            new Set(
              [...write.replacedPaths].filter((path) => Object.hasOwn(partial, path.split('.')[0])),
            ),
        });
      }
    }
    return overlaps;
  }

  private captureTransactionRecord(id: EntityId) {
    if (this.transactionSnapshots && !this.transactionSnapshots.records.has(id)) {
      const mask = this.coverage.get(id);
      this.transactionSnapshots.records.set(id, {
        // Compiled coverage is immutable; mergeInternal copies it before edits.
        mask: mask && (this.sharedCoverage.has(mask) ? mask : cloneMask(mask)),
        record: this.records.get(id),
      });
      this.transactionStale?.set(id, this.stalePaths.get(id));
    }
  }

  private captureRecord(id: EntityId) {
    this.captureTransactionRecord(id);

    if (!this.rebase) {
      return;
    }
    for (const target of [this.rebase, this.recordingLayer && this.optimisticBase]) {
      if (target && !target.records.has(id)) {
        const mask = this.coverage.get(id);
        target.records.set(id, {
          mask: mask && (this.sharedCoverage.has(mask) ? mask : cloneMask(mask)),
          record: this.records.get(id),
        });
      }
    }
  }

  private captureList(key: string) {
    if (this.transactionSnapshots && !this.transactionSnapshots.lists.has(key)) {
      this.transactionSnapshots.lists.set(key, this.lists.get(key));
    }
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
      lists: copyIndexValues(this.listKeysByReferencedEntity.get(id)),
      records: [...(this.recordReferencesByTarget.get(id)?.keys() ?? [])],
    };
  }

  /** Check incoming references without treating optimistic relationships as confirmed. */
  hasConfirmedRecordReference(
    target: EntityId,
    include: (owner: EntityId, field: string) => boolean,
  ): boolean {
    for (const [owner, fields] of this.recordReferencesByTarget.get(target) ?? []) {
      if (!this.optimisticBase.records.has(owner)) {
        for (const field of indexValues(fields)) {
          if (include(owner, field)) {
            return true;
          }
        }
      }
    }
    for (const [owner, { record }] of this.optimisticBase.records) {
      for (const [field, value] of Object.entries(record ?? {})) {
        if (include(owner, field)) {
          const refs = this.getRecordFieldReferences(value);
          if (typeof refs === 'string' ? refs === target : refs?.has(target)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /** @internal List keys whose result depends on this entity's coverage. */
  getListKeysForEntity(id: EntityId): ReadonlyArray<string> {
    return copyIndexValues(this.listKeysByReferencedEntity.get(id));
  }

  /** @internal Read one confirmed record without copying the cache. */
  readConfirmed(id: EntityId) {
    const snapshot = this.optimisticBase.records.get(id);
    const record = snapshot ? snapshot.record : this.records.get(id);
    const mask = snapshot ? snapshot.mask : this.coverage.get(id);
    const stale = this.stalePaths.get(id);
    return record
      ? { paths: mask ? toPaths(mask) : [], record, ...(stale && { stale }) }
      : undefined;
  }

  /** @internal Read confirmed data without allocating coverage paths or a snapshot wrapper. */
  confirmedRecord(id: EntityId) {
    const snapshot = this.optimisticBase.records.get(id);
    return snapshot ? snapshot.record : this.records.get(id);
  }

  /** @internal */
  recordIds() {
    return this.records.keys();
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
      ...(this.stalePaths.size && { stale: [...this.stalePaths] }),
    };
  }

  dehydrate(): StoreHydrationState {
    return {
      coverage: [...this.coverage].map(([id, mask]) => [id, toPaths(mask)]),
      lists: [...this.lists],
      records: [...this.records],
      ...(this.stalePaths.size && { stale: [...this.stalePaths] }),
    };
  }

  hydrate(
    state: StoreHydrationState,
    mode: 'preserve-existing' | 'replace',
    options: { deferNotifications?: boolean; initialRecords?: WeakSet<AnyRecord> } = {},
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
        previous && mode === 'preserve-existing' && !options.initialRecords?.has(previous)
          ? (mergePreservingExisting(incoming, previous) as AnyRecord)
          : incoming;
      records.set(id, previous && areHydrationValuesEqual(previous, next) ? previous : next);
    }

    for (const [id, paths] of state.coverage) {
      const incoming = fromPaths(paths);
      const previous = coverage.get(id);
      if (
        previous &&
        mode === 'preserve-existing' &&
        !options.initialRecords?.has(previousRecords.get(id)!)
      ) {
        union(previous, incoming);
      } else {
        coverage.set(id, incoming);
      }
    }

    for (const [key, list] of state.lists) {
      const previous = lists.get(key);
      const owner = options.initialRecords && parseListKey(key);
      // Replacing an untouched initializer also replaces its relationship membership.
      const initialOwner =
        owner && options.initialRecords?.has(previousRecords.get(owner.ownerId)!);
      if (mode === 'replace' || !previous || initialOwner) {
        lists.set(key, previous && areHydrationValuesEqual(previous, list) ? previous : list);
      }
    }

    if (mode === 'replace') {
      this.stalePaths.clear();
    }
    for (const [id, paths] of state.stale ?? []) {
      this.restoreRecordStaleness(id, paths, mode === 'replace');
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

  merge(
    id: EntityId,
    partial: AnyRecord,
    paths: Iterable<string>,
    replacedPaths: Iterable<string> = [],
    refresh = false,
  ): void {
    if (!this.rebase && this.optimisticLayers.size) {
      return this.update(() => this.merge(id, partial, paths, replacedPaths, refresh));
    }
    this.captureTransactionRecord(id);
    const stale = refresh && !this.recordingLayer ? this.stalePaths.get(id) : undefined;
    const refreshed = stale ? new Set([...paths, ...replacedPaths]) : undefined;
    const change = this.mergeInternal(id, partial, paths, replacedPaths);
    if (stale && refreshed) {
      const mask = fromPaths(refreshed);
      const remaining = stale.filter((path) => !isCovered(mask, path));
      if (remaining.length !== stale.length) {
        if (remaining.length) {
          this.stalePaths.set(id, remaining);
        } else {
          this.stalePaths.delete(id);
        }
        this.notify(
          id,
          new Set([...refreshed, ...(change?.paths ?? [])]),
          true,
          change?.referencesChanged,
          new Set([...refreshed, ...(change?.patchPaths ?? change?.paths ?? [])]),
        );
        return;
      }
    }
    if (change) {
      this.notify(id, change.paths, true, change.referencesChanged, change.patchPaths);
    }
  }

  private mergeInternal(
    id: EntityId,
    partial: AnyRecord,
    paths: Iterable<string>,
    replacedPaths: Iterable<string> = [],
  ): {
    patchPaths?: ReadonlySet<string>;
    paths: ReadonlySet<string>;
    referencesChanged: boolean;
  } | null {
    this.captureRecord(id);
    const selectedPaths = this.recordingLayer ? new Set(paths) : paths;
    const selection = isCoverageSelection(selectedPaths) ? selectedPaths : undefined;
    if (this.recordingLayer) {
      const write = this.recordingLayer.writes.get(id) ?? {
        partial: Object.create(null) as AnyRecord,
        paths: new Set<string>(),
      };
      Object.assign(write.partial, partial);
      for (const path of selectedPaths) {
        write.paths.add(path);
      }
      for (const path of replacedPaths) {
        (write.replacedPaths ??= new Set()).add(path);
      }
      this.recordingLayer.writes.set(id, write);
    }
    const previous = this.records.get(id);
    const changedPaths = new Set<string>();

    let mask = this.coverage.get(id);
    if (!mask) {
      mask = !previous && selection ? selection.mask : emptyMask();
      if (!previous && selection) {
        this.sharedCoverage.set(mask, selection.paths);
      }
      this.coverage.set(id, mask);
    }

    const coveragePaths = selection ? selection.paths : [...selectedPaths];
    const replacements = previous ? [...replacedPaths] : [];
    const previousMask = replacements.length ? cloneMask(mask) : undefined;
    const sharedPaths = this.sharedCoverage.get(mask);
    const sameCoverage =
      mask === selection?.mask ||
      (sharedPaths?.length === coveragePaths.length &&
        coveragePaths.every((path, index) => path === sharedPaths?.[index]));
    let shared = sharedPaths !== undefined;
    if (shared && replacements.length) {
      mask = cloneMask(mask);
      this.coverage.set(id, mask);
      shared = false;
    }
    for (const path of replacements) {
      removePath(mask, path);
    }
    if (replacements.length || !sameCoverage) {
      for (const path of coveragePaths) {
        if (shared) {
          if (isCovered(mask, path)) {
            continue;
          }
          mask = cloneMask(mask);
          this.coverage.set(id, mask);
          shared = false;
        }
        if (addPath(mask, path) && previous) {
          changedPaths.add(path);
        }
      }
    }
    if (previousMask && !areMasksEqual(previousMask, mask)) {
      for (const path of replacements) {
        changedPaths.add(path);
      }
    } else if (previousMask) {
      changedPaths.clear();
    }

    if (previous) {
      let hasChanges = changedPaths.size > 0;
      const patchPaths = coveragePaths.some((path) => path.includes('.'))
        ? new Set(changedPaths)
        : undefined;
      for (const key of Object.keys(partial)) {
        const value = partial[key];
        if (previous[key] !== value) {
          hasChanges = true;
          changedPaths.add(key);
          if (patchPaths) {
            collectRecordPatchPaths(
              patchPaths,
              previous[key],
              value,
              key,
              coveragePaths,
              replacements,
            );
          }
        }
      }

      if (!hasChanges) {
        return null;
      }

      const nextRecord = { ...previous, ...partial };
      const referencesChanged = this.recordReferencesChanged(previous, nextRecord, changedPaths);
      this.records.set(id, nextRecord);
      this.updateRecordReferenceIndexes(id, previous, nextRecord, changedPaths);
      return { patchPaths, paths: changedPaths, referencesChanged };
    } else {
      const nextRecord = { ...partial };
      this.records.set(id, nextRecord);
      this.updateRecordReferenceIndexes(id, undefined, nextRecord, Object.keys(nextRecord));
      return {
        paths: changedPaths,
        referencesChanged: this.recordReferenceFields.has(id),
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
        this.stalePaths.delete(id);
        this.publishChange({ key: id, kind: 'record', referencesChanged: true });
        if (record && !this.rebase && !this.previewing && this.subscriptions.has(id)) {
          // Let synchronous reference removal or replacement finish before readers refetch.
          queueMicrotask(() => this.notify(id, undefined, false));
        }
      }
    });
  }

  invalidateRecord(id: EntityId, includePath?: (path: string) => boolean) {
    this.captureTransactionRecord(id);
    const mask = this.coverage.get(id);
    const record = this.records.get(id);
    const covered = mask && record && expandStalePaths(record, toPaths(mask));
    const paths = includePath ? covered?.filter(includePath) : covered;
    if (paths?.length) {
      this.stalePaths.set(id, paths);
      this.publishChange({ invalidated: true, key: id, kind: 'record', referencesChanged: false });
    }
  }

  /** @internal Only restore staleness for fields supplied by the incoming cache. */
  restoreRecordStaleness(id: EntityId, paths?: ReadonlyArray<string>, replace = false) {
    this.captureTransactionRecord(id);
    const incoming = paths?.filter((path) => replace || !this.hasCoverage(id, path));
    if (incoming?.length) {
      this.stalePaths.set(id, [...new Set([...(this.stalePaths.get(id) ?? []), ...incoming])]);
    }
  }

  hasStaleRecord(id: EntityId) {
    return this.stalePaths.has(id);
  }

  hasStalePath(id: EntityId, path: string) {
    return this.stalePaths
      .get(id)
      ?.some(
        (stale) => stale === path || stale.startsWith(`${path}.`) || path.startsWith(`${stale}.`),
      );
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

  hasCoverage(id: EntityId, path: string): boolean {
    const mask = this.coverage.get(id);
    return this.records.has(id) && !!mask && isCovered(mask, path);
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
    patchPaths?: ReadonlySet<string>,
  ) {
    if (confirmed && !this.recordingLayer) {
      this.publishChange({ key: id, kind: 'record', patchPaths, paths, referencesChanged });
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

      if (this.transactionSubscribers) {
        this.transactionSubscribers.add(fn);
        continue;
      }
      try {
        fn();
      } catch {
        /* empty */
      }
    }
  }

  private notifyListSubscribers(
    key: string,
    confirmed = true,
    previousList?: List,
    owner = parseListKey(key),
  ) {
    if (confirmed && !this.recordingLayer) {
      this.publishChange({ key, kind: 'list', previousList }, owner);
    }
    if (this.rebase) {
      return;
    }
    const set = this.listSubscriptions.get(key);
    if (!set) {
      return;
    }

    for (const fn of set) {
      if (this.transactionSubscribers) {
        this.transactionSubscribers.add(fn);
        continue;
      }
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
    if (keys === undefined) {
      return entries;
    }

    for (const key of indexValues(keys)) {
      const list = this.lists.get(key);
      if (list) {
        entries.push([key, list]);
      }
    }
    return entries;
  }

  setList(key: string, state: List, owner = parseListKey(key)): void {
    if (!this.rebase && this.optimisticLayers.size) {
      return this.update(() => this.setList(key, state, owner));
    }
    this.writeList(key, state, owner);
  }

  private writeList(
    key: string,
    state: List | undefined,
    owner = parseListKey(key),
    confirmed = true,
  ) {
    this.captureList(key);
    const previous = this.lists.get(key);
    const sameReferences =
      previous &&
      state &&
      areListIdsEqual(previous.ids, state.ids) &&
      areListIdsEqual(previous.liveAfterIds, state.liveAfterIds) &&
      areListIdsEqual(previous.liveBeforeIds, state.liveBeforeIds) &&
      areListIdsEqual(previous.pendingAfterIds, state.pendingAfterIds) &&
      areListIdsEqual(previous.pendingBeforeIds, state.pendingBeforeIds);
    if (previous && !sameReferences) {
      this.removeListIndexes(key, previous, owner);
    }
    if (state) {
      this.lists.set(key, state);
      if (!sameReferences) {
        this.addListIndexes(key, state, owner);
      }
    } else {
      this.lists.delete(key);
    }
    this.notifyListSubscribers(key, confirmed, previous, owner);
  }

  replaceListEntityId(previousId: EntityId, nextId: EntityId) {
    return this.update(() => {
      const keys = copyIndexValues(this.listKeysByReferencedEntity.get(previousId));
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

        const acknowledgedInsertions =
          dedupe(list.acknowledgedInsertions) ?? list.acknowledgedInsertions;
        const insertedBeforeIds = dedupe(list.insertedBeforeIds) ?? list.insertedBeforeIds;
        const insertedAfterIds = dedupe(list.insertedAfterIds) ?? list.insertedAfterIds;
        const pendingBeforeIds = dedupe(list.pendingBeforeIds) ?? list.pendingBeforeIds;
        const pendingAfterIds = dedupe(list.pendingAfterIds) ?? list.pendingAfterIds;
        const liveBeforeIds = dedupe(list.liveBeforeIds) ?? list.liveBeforeIds;
        const liveAfterIds = dedupe(list.liveAfterIds) ?? list.liveAfterIds;

        if (!changed) {
          continue;
        }

        const canonicalIds = new Set(ids);
        this.setList(key, {
          acknowledgedInsertions,
          afterCursor: list.afterCursor,
          backwardPageLimit: list.backwardPageLimit,
          beforeCursor: list.beforeCursor,
          cursors,
          forwardPageLimit: list.forwardPageLimit,
          ids,
          insertedAfterIds,
          insertedBeforeIds,
          liveAfterIds: liveAfterIds?.filter((id) => !canonicalIds.has(id)),
          liveBeforeIds: liveBeforeIds?.filter((id) => !canonicalIds.has(id)),
          pagination: list.pagination,
          pendingAfterIds: pendingAfterIds?.filter((id) => !canonicalIds.has(id)),
          pendingBeforeIds: pendingBeforeIds?.filter((id) => !canonicalIds.has(id)),
          stale: list.stale,
          unloaded: list.unloaded,
          windows: list.windows,
        });
      }
    });
  }

  restoreList(key: string, list?: List) {
    return this.update(() => this.writeList(key, list));
  }

  collectGarbage(
    markedRecords: ReadonlySet<EntityId>,
    markedLists: ReadonlySet<string>,
    options: { onRecordDeleted?: (id: EntityId, record: AnyRecord | undefined) => void } = {},
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
      this.stalePaths.delete(id);
      options.onRecordDeleted?.(id, record);
    }

    for (const key of lists) {
      this.update(() => this.writeList(key, undefined, undefined, false));
    }

    return { lists, records };
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
      const listKeys = copyIndexValues(this.listKeysByReferencedEntity.get(targetId));
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
          acknowledgedInsertions: list.acknowledgedInsertions?.filter((id) => id !== targetId),
          afterCursor: list.afterCursor,
          backwardPageLimit: list.backwardPageLimit,
          beforeCursor: list.beforeCursor,
          cursors,
          forwardPageLimit: list.forwardPageLimit,
          ids: entityIds,
          insertedAfterIds: list.insertedAfterIds?.filter((id) => id !== targetId),
          insertedBeforeIds: list.insertedBeforeIds?.filter((id) => id !== targetId),
          liveAfterIds: list.liveAfterIds?.filter((id) => id !== targetId),
          liveBeforeIds: list.liveBeforeIds?.filter((id) => id !== targetId),
          pagination: list.pagination,
          pendingAfterIds: list.pendingAfterIds?.filter((id) => id !== targetId),
          pendingBeforeIds: list.pendingBeforeIds?.filter((id) => id !== targetId),
          stale: list.stale,
          unloaded: list.unloaded,
          windows: list.windows,
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
        const next: AnyRecord = Object.create(null);
        const paths = new Set<string>();

        for (const key of indexValues(fields)) {
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
    this.captureTransactionRecord(id);
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
      this.notify(id, undefined, false);
    });
  }

  private addListIndexes(key: string, list: List, parsed = parseListKey(key)) {
    if (parsed) {
      addIndexValue(this.listKeysByOwnerField, getOwnerFieldKey(parsed.ownerId, parsed.field), key);
    }
    for (const id of this.getListReferencedEntityIds(list)) {
      addIndexValue(this.listKeysByReferencedEntity, id, key);
    }
  }

  private removeListIndexes(key: string, list: List, parsed = parseListKey(key)) {
    if (parsed) {
      removeIndexValue(
        this.listKeysByOwnerField,
        getOwnerFieldKey(parsed.ownerId, parsed.field),
        key,
      );
    }
    for (const id of this.getListReferencedEntityIds(list)) {
      removeIndexValue(this.listKeysByReferencedEntity, id, key);
    }
  }

  private getListReferencedEntityIds(list: List): Iterable<EntityId> {
    if (
      !list.liveAfterIds?.length &&
      !list.liveBeforeIds?.length &&
      !list.pendingAfterIds?.length &&
      !list.pendingBeforeIds?.length
    ) {
      return list.ids;
    }
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

  private getRecordFieldReferences(value: unknown): IndexedValues | undefined {
    if (Array.isArray(value)) {
      let ids: IndexedValues | undefined;
      for (const item of value) {
        if (isNodeRef(item)) {
          ids = appendIndexValue(ids, getNodeRefId(item));
        }
      }
      return ids;
    }
    return isNodeRef(value) ? getNodeRefId(value) : undefined;
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
      if (previous?.[field] === next?.[field]) {
        continue;
      }
      const before = this.getRecordFieldReferences(previous?.[field]);
      const after = this.getRecordFieldReferences(next?.[field]);
      if (before === after) {
        continue;
      }
      if (
        (typeof before === 'string' ? 1 : before?.size) !==
        (typeof after === 'string' ? 1 : after?.size)
      ) {
        return true;
      }
      if (before !== undefined) {
        for (const id of indexValues(before)) {
          if (typeof after === 'string' ? id !== after : !after?.has(id)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private addRecordFieldReferenceIndex(id: EntityId, field: string, value: unknown) {
    const targets = this.getRecordFieldReferences(value);
    if (targets === undefined) {
      return;
    }
    let fields = this.recordReferenceFields.get(id);
    if (!fields) {
      fields = new Map();
      this.recordReferenceFields.set(id, fields);
    }
    fields.set(field, targets);
    for (const targetId of indexValues(targets)) {
      let records = this.recordReferencesByTarget.get(targetId);
      if (!records) {
        records = new Map();
        this.recordReferencesByTarget.set(targetId, records);
      }
      addIndexValue(records, id, field);
    }
  }

  private removeRecordFieldReferenceIndex(id: EntityId, field: string) {
    const fields = this.recordReferenceFields.get(id);
    const targets = fields?.get(field);
    if (!fields || targets === undefined) {
      return;
    }
    for (const targetId of indexValues(targets)) {
      const records = this.recordReferencesByTarget.get(targetId);
      if (records) {
        removeIndexValue(records, id, field);
        if (records.size === 0) {
          this.recordReferencesByTarget.delete(targetId);
        }
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
