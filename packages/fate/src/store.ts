import {
  cloneMask,
  diffPaths,
  emptyMask,
  FieldMask,
  fromPaths,
  markAll,
  union,
} from './mask.ts';
import type { EntityId, FateRecord, Snapshot } from './types.ts';

export type Subscriptions = Map<EntityId, Set<() => void>>;

const cloneValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (value != null && typeof value === 'object') {
    const result: FateRecord = {};
    for (const [key, record] of Object.entries(value)) {
      result[key] = cloneValue(record);
    }
    return result;
  }

  return value;
};

export class Store {
  private coverage = new Map<EntityId, FieldMask>();
  private lists = new Map<string, Array<EntityId>>();
  private records = new Map<EntityId, FateRecord>();
  private subscriptions: Subscriptions = new Map();

  read(id: EntityId) {
    return this.records.get(id);
  }

  merge(id: EntityId, partial: FateRecord, paths?: Iterable<string> | '*') {
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
    this.notify(id);
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

  getList(key: string): Array<EntityId> | undefined {
    return this.lists.get(key);
  }

  setList(key: string, ids: Array<EntityId>) {
    this.lists.set(key, ids);
  }

  snapshot(id: EntityId): Snapshot {
    const record = this.records.get(id);
    const mask = this.coverage.get(id);
    return {
      mask: mask ? cloneMask(mask) : undefined,
      record: record ? (cloneValue(record) as FateRecord) : undefined,
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
