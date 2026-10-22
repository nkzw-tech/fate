import {
  FateThenable,
  ViewSnapshot,
  type Entity,
  type EntityId,
  type Selection,
  type View,
  type ViewRef,
} from './types.ts';

type CachedSnapshot = FateThenable<ViewSnapshot<any, any>>;
type CacheEntry = {
  dependencies: ReadonlyArray<{ cache: EntityCache; fields: ReadonlySet<string> | null }>;
  revision: number;
  thenable: CachedSnapshot;
};
type EntityCache = {
  fields?: Map<string, number>;
  invalidated: number;
  revision: number;
  views: WeakMap<View<any, any>, WeakMap<ViewRef<string>, CacheEntry>>;
};

export default class ViewDataCache {
  constructor(private readonly isEnabled: () => boolean = () => true) {}

  private cache = new Map<EntityId, EntityCache>();
  private revision = 0;

  private entityCache(entityId: EntityId): EntityCache {
    let cache = this.cache.get(entityId);
    if (!cache) {
      cache = { invalidated: 0, revision: 0, views: new WeakMap() };
      this.cache.set(entityId, cache);
    }
    return cache;
  }

  clear() {
    this.cache.clear();
  }

  get<T extends Entity, S extends Selection<T>, V extends View<T, S>>(
    entityId: EntityId,
    view: V,
    ref: ViewRef<T['__typename']>,
  ): FateThenable<ViewSnapshot<T, S>> | null {
    if (!this.isEnabled()) {
      return null;
    }
    const entry = this.cache.get(entityId)?.views.get(view)?.get(ref);
    if (!entry) {
      return null;
    }
    if (entry.revision !== this.revision) {
      for (const { cache, fields } of entry.dependencies) {
        if (cache.invalidated > entry.revision) {
          return null;
        }
        if (cache.revision <= entry.revision) {
          continue;
        }
        if (!fields) {
          return null;
        }
        for (const field of fields) {
          if ((cache.fields?.get(field) ?? 0) > entry.revision) {
            return null;
          }
        }
      }
      entry.revision = this.revision;
    }
    return entry.thenable;
  }

  set<T extends Entity, S extends Selection<T>, V extends View<T, S>>(
    entityId: EntityId,
    view: V,
    ref: ViewRef<T['__typename']>,
    thenable: FateThenable<ViewSnapshot<T, S>>,
    dependencies: ReadonlySet<EntityId>,
  ) {
    if (!this.isEnabled()) {
      return;
    }
    const entityMap = this.entityCache(entityId).views;
    let viewMap = entityMap.get(view);
    if (!viewMap) {
      viewMap = new WeakMap();
      entityMap.set(view, viewMap);
    }
    const coverage = new Map<EntityId, ReadonlySet<string> | null>(thenable.value?.coverage);
    for (const id of [entityId, ...dependencies]) {
      if (!coverage.has(id)) {
        coverage.set(id, null);
      }
    }
    // Coverage already includes every nested entity. Keep dependencies only on
    // this weakly held snapshot instead of accumulating a reverse entity graph.
    viewMap.set(ref, {
      dependencies: [...coverage].map(([id, fields]) => ({ cache: this.entityCache(id), fields })),
      revision: this.revision,
      thenable,
    });
  }

  invalidate(entityId: EntityId, paths?: Iterable<string>) {
    if (!this.isEnabled()) {
      return;
    }
    const cache = this.cache.get(entityId);
    if (!cache) {
      return;
    }
    let revision = 0;
    if (paths) {
      for (const path of paths) {
        revision ||= ++this.revision;
        (cache.fields ??= new Map()).set(path.split('.')[0], revision);
      }
    }
    if (revision) {
      cache.revision = revision;
    } else {
      cache.invalidated = ++this.revision;
      cache.fields?.clear();
      this.cache.delete(entityId);
    }
  }
}
