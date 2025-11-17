import ViewDataCache from './cache.ts';
import {
  cloneMask,
  diffPaths,
  emptyMask,
  FieldMask,
  fromPaths,
  union,
} from './mask.ts';
import { getNodeRefId, isNodeRef } from './node-ref.ts';
import type { AnyRecord, EntityId, Pagination, Snapshot } from './types.ts';

export type List = Readonly<{
  cursors?: ReadonlyArray<string | undefined>;
  ids: ReadonlyArray<EntityId>;
  pagination?: Pagination;
}>;

export type Subscriptions = Map<EntityId, Set<() => void>>;

export const getListKey = (
  ownerId: EntityId,
  field: string,
  hash = 'default',
): string => `${ownerId} __fate__ ${field} __fate__ ${hash}`;

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

export class Store {
  private coverage = new Map<EntityId, FieldMask>();
  private lists = new Map<string, List>();
  private records = new Map<EntityId, AnyRecord>();
  private subscriptions: Subscriptions = new Map();
  private listSubscriptions = new Map<string, Set<() => void>>();

  read(id: EntityId) {
    return this.records.get(id);
  }

  merge(id: EntityId, partial: AnyRecord, paths: Iterable<string>) {
    if (this.mergeInternal(id, partial, paths)) {
      this.notify(id);
    }
  }

  private mergeInternal(
    id: EntityId,
    partial: AnyRecord,
    paths: Iterable<string>,
  ): boolean {
    const previous = this.records.get(id);

    if (previous) {
      let hasChanges = false;
      for (const [key, value] of Object.entries(partial)) {
        if (previous[key] !== value) {
          hasChanges = true;
          break;
        }
      }

      if (!hasChanges) {
        return false;
      }

      this.records.set(id, { ...previous, ...partial });
    } else {
      this.records.set(id, { ...partial });
    }

    let mask = this.coverage.get(id);
    if (!mask) {
      mask = emptyMask();
      this.coverage.set(id, mask);
    }

    union(mask, fromPaths(paths));
    return true;
  }

  deleteRecord(id: EntityId) {
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

  subscribe(id: EntityId, fn: () => void): () => void {
    let set = this.subscriptions.get(id);
    if (!set) {
      set = new Set();
      this.subscriptions.set(id, set);
    }

    set.add(fn);

    return () => {
      const subscription = this.subscriptions.get(id);
      if (!subscription) {
        return;
      }

      subscription.delete(fn);
      if (subscription.size === 0) {
        this.subscriptions.delete(id);
      }
    };
  }

  private notify(id: EntityId) {
    const set = this.subscriptions.get(id);
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

  getListsForField(
    ownerId: EntityId,
    field: string,
  ): Array<readonly [string, List]> {
    const entries: Array<readonly [string, List]> = [];
    const prefix = getListKey(ownerId, field, '');
    for (const entry of this.lists.entries()) {
      if (entry[0].startsWith(prefix)) {
        entries.push(entry);
      }
    }
    return entries;
  }

  setList(key: string, state: List) {
    this.lists.set(key, state);
    this.notifyListSubscribers(key);
  }

  restoreList(key: string, list?: List) {
    if (list == null) {
      this.lists.delete(key);
    } else {
      this.setList(key, list);
    }
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
    for (const [key, list] of this.lists.entries()) {
      const { ids } = list;
      if (!ids.includes(targetId)) {
        continue;
      }

      if (listSnapshots && !listSnapshots.has(key)) {
        listSnapshots.set(key, list);
      }

      const entityIds: Array<EntityId> = [];
      const cursors = list.cursors
        ? ([] as Array<string | undefined>)
        : undefined;

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
        cursors,
        ids: entityIds,
        pagination: list.pagination,
      });
    }

    const ids = new Set<EntityId>();

    for (const [id, record] of this.records.entries()) {
      let updated = false;
      const next: AnyRecord = {};
      const paths = new Set<string>();

      for (const [key, value] of Object.entries(record)) {
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
      ids.add(id);
    }

    for (const id of ids) {
      this.notify(id);
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
    if (snapshot.record === undefined) {
      this.records.delete(id);
    } else {
      this.records.set(id, snapshot.record);
    }

    if (snapshot.mask === undefined) {
      this.coverage.delete(id);
    } else {
      this.coverage.set(id, snapshot.mask);
    }

    this.notify(id);
  }
}
