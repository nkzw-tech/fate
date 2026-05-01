import ViewDataCache from './cache.ts';
import {
  cloneMask,
  diffPaths,
  emptyMask,
  FieldMask,
  fromPaths,
  intersects,
  union,
} from './mask.ts';
import { getNodeRefId, isNodeRef } from './node-ref.ts';
import type { AnyRecord, EntityId, Pagination, Snapshot } from './types.ts';

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

type Subscription = Readonly<{ fn: () => void; mask: FieldMask | null }>;

export type Subscriptions = Map<EntityId, Set<Subscription>>;

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

const cloneValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (isNodeRef(value)) {
    return value;
  }

  if (value != null && typeof value === 'object') {
    const result: AnyRecord = {};
    for (const [key, record] of Object.entries(value)) {
      result[key] = cloneValue(record);
    }
    return result;
  }

  return value;
};

const emptyFunction = () => {};

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

  read(id: EntityId) {
    return this.records.get(id);
  }

  merge(id: EntityId, partial: AnyRecord, paths: Iterable<string>) {
    const changedPaths = this.mergeInternal(id, partial, paths);
    if (changedPaths) {
      this.notify(id, changedPaths);
    }
  }

  private mergeInternal(
    id: EntityId,
    partial: AnyRecord,
    paths: Iterable<string>,
  ): ReadonlySet<string> | null {
    const previous = this.records.get(id);
    const changedPaths = new Set<string>();

    let mask = this.coverage.get(id);
    if (!mask) {
      mask = emptyMask();
      this.coverage.set(id, mask);
    }

    union(mask, fromPaths(paths));

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
      this.records.set(id, nextRecord);
      this.updateRecordReferenceIndexes(id, previous, nextRecord, changedPaths);
    } else {
      const nextRecord = { ...partial };
      this.records.set(id, nextRecord);
      this.updateRecordReferenceIndexes(id, undefined, nextRecord, Object.keys(nextRecord));
    }

    return changedPaths;
  }

  deleteRecord(id: EntityId) {
    const record = this.records.get(id);
    if (record) {
      this.removeRecordReferenceIndexes(id, record);
    }
    this.records.delete(id);
    this.coverage.delete(id);
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

  private notify(id: EntityId, paths?: Iterable<string>) {
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

  private notifyListSubscribers(key: string) {
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
    const previous = this.lists.get(key);
    if (previous) {
      this.removeListIndexes(key, previous);
    }
    this.lists.set(key, state);
    this.addListIndexes(key, state);
    this.notifyListSubscribers(key);
  }

  replaceListEntityId(previousId: EntityId, nextId: EntityId) {
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
  }

  restoreList(key: string, list?: List) {
    if (list == null) {
      this.deleteList(key);
    } else {
      this.setList(key, list);
    }
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
      this.deleteList(key);
    }

    return { lists, records };
  }

  private deleteList(key: string) {
    const previous = this.lists.get(key);
    if (previous) {
      this.removeListIndexes(key, previous);
    }
    this.lists.delete(key);
    this.notifyListSubscribers(key);
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

  removeReferencesTo(
    targetId: EntityId,
    viewDataCache: ViewDataCache,
    snapshots?: Map<EntityId, Snapshot>,
    listSnapshots?: Map<string, List>,
  ) {
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

      if (listSnapshots && !listSnapshots.has(key)) {
        listSnapshots.set(key, list);
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

      if (snapshots && !snapshots.has(id)) {
        snapshots.set(id, this.snapshot(id));
      }

      viewDataCache.invalidate(id);
      this.mergeInternal(id, next, paths);
      ids.set(id, paths);
    }

    for (const [id, paths] of ids) {
      this.notify(id, paths);
    }
  }

  snapshot(id: EntityId): Snapshot {
    const record = this.records.get(id);
    const mask = this.coverage.get(id);
    return {
      mask: mask ? cloneMask(mask) : undefined,
      record: record ? (cloneValue(record) as AnyRecord) : undefined,
    };
  }

  restore(id: EntityId, snapshot: Snapshot) {
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

    this.notify(id);
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
