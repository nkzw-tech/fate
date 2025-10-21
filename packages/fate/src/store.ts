import {
  diffPaths,
  emptyMask,
  FieldMask,
  fromPaths,
  markAll,
  union,
} from './mask.ts';
import { pathsFromSelection } from './selection.ts';
import type { EntityId, PageInfo } from './types.ts';

export type Subscriptions = Map<EntityId, Set<() => void>>;

export class Store {
  private records = new Map<EntityId, Record<string, unknown>>();
  private coverage = new Map<EntityId, FieldMask>();
  private subscriptions: Subscriptions = new Map();
  private lists = new Map<string, Array<EntityId>>();
  private pageInfo = new Map<string, PageInfo>();
  private maskedCache = new Map<string, unknown>();

  read(id: EntityId) {
    return this.records.get(id);
  }

  hasFullCoverage(id: EntityId): boolean {
    const mask = this.coverage.get(id);
    return !!mask && mask.all;
  }

  merge(
    id: EntityId,
    partial: Record<string, unknown>,
    paths?: Array<string> | '*',
  ) {
    const previous = this.records.get(id) ?? {};
    const next = { ...previous, ...partial };
    this.records.set(id, next);

    let mask = this.coverage.get(id);
    if (!mask) {
      mask = emptyMask();
      this.coverage.set(id, mask);
    }

    this.maskedCache.delete(`${id}|*`);

    if (paths === '*' || paths === undefined) {
      const full = markAll();
      this.coverage.set(id, full);
    } else {
      union(mask, fromPaths(paths));
    }
    this.notify(id);
  }

  addCoveragePaths(id: EntityId, paths: Array<string>) {
    let mask = this.coverage.get(id);
    if (!mask) {
      mask = emptyMask();
      this.coverage.set(id, mask);
    }

    union(mask, fromPaths(paths));
  }

  missingForSelect(id: EntityId, paths?: Array<string>): Array<string> | '*' {
    if (!this.records.has(id)) {
      return '*';
    }
    const mask = this.coverage.get(id) ?? emptyMask();
    if (!paths) {
      return mask.all ? [] : '*';
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

  appendToList(key: string, ids: Array<EntityId>) {
    const previous = this.lists.get(key) ?? [];
    const merged = [...previous];
    for (const id of ids) {
      if (!merged.includes(id)) {
        merged.push(id);
      }
    }
    this.lists.set(key, merged);
  }

  getPageInfo(key: string): PageInfo | undefined {
    return this.pageInfo.get(key);
  }

  setPageInfo(key: string, info: PageInfo) {
    this.pageInfo.set(key, info);
  }

  denormalizeMasked(id: EntityId, select?: Record<string, unknown>) {
    const key = `${id}|${select ? pathsFromSelection(select)!.join(',') : '*'}`;
    const cached = this.maskedCache.get(key);
    if (cached) {
      return cached;
    }

    const record = this.records.get(id);
    if (!record) {
      return undefined;
    }

    const result = select ? denormalizeMasked(this, id, select) : record;
    this.maskedCache.set(key, result);
    return result;
  }
}

const denormalizeMasked = (
  cache: Store,
  id: EntityId,
  select?: Record<string, unknown>,
) => {
  const record = cache.read(id);
  if (!record) {
    return undefined;
  }
  if (!select) {
    return { ...record };
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(select)) {
    const request = select[key];
    const value = record[key];
    if (request === true) {
      result[key] = value;
    } else if (request && typeof request === 'object') {
      if (Array.isArray(value)) {
        result[key] = value.map((cid: string) =>
          denormalizeMasked(cache, cid, request as Record<string, unknown>),
        );
      } else if (typeof value === 'string') {
        result[key] = denormalizeMasked(
          cache,
          value,
          request as Record<string, unknown>,
        );
      } else if (value && typeof value === 'object') {
        const nested: Record<string, unknown> = {};
        for (const subKey of Object.keys(request)) {
          nested[subKey] = (value as Record<string, unknown> | null)?.[subKey];
        }
        result[key] = nested;
      } else {
        result[key] = undefined;
      }
    }
  }
  return result;
};
