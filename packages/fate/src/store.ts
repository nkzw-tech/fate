import ViewDataCache from './cache.ts';
import {
  cloneMask,
  diffPaths,
  emptyMask,
  FieldMask,
  fromPaths,
  markAll,
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

  read(id: EntityId) {
    return this.records.get(id);
  }

  merge(id: EntityId, partial: AnyRecord, paths?: Iterable<string> | '*') {
    this.mergeInternal(id, partial, paths);
    this.notify(id);
  }

  private mergeInternal(
    id: EntityId,
    partial: AnyRecord,
    paths?: Iterable<string> | '*',
  ) {
    const previous = this.records.get(id) ?? {};
    const next = { ...previous, ...partial };
    this.records.set(id, next);

    let mask = this.coverage.get(id);
    if (!mask) {
      mask = emptyMask();
      this.coverage.set(id, mask);
    }

    if (paths === '*' || paths === undefined) {
      const full = markAll();
      this.coverage.set(id, full);
    } else {
      union(mask, fromPaths(paths));
    }
  }

  deleteRecord(id: EntityId) {
    this.records.delete(id);
    this.coverage.delete(id);
  }

  missingForSelection(
    id: EntityId,
    paths?: Iterable<string>,
  ): Set<string> | '*' {
    if (!this.records.has(id)) {
      return '*';
    }
    const mask = this.coverage.get(id) ?? emptyMask();
    if (!paths) {
      return mask.all ? new Set() : '*';
    }
    return diffPaths(paths, mask);
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

  getList(key: string): ReadonlyArray<EntityId> | undefined {
    return this.lists.get(key)?.ids;
  }

  getListState(key: string): List | undefined {
    return this.lists.get(key);
  }

  setList(key: string, state: List) {
    this.lists.set(key, state);
  }

  restoreList(key: string, list?: List) {
    if (list == null) {
      this.lists.delete(key);
    } else {
      this.setList(key, list);
    }
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
