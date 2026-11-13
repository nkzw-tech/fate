import { argumentFieldKey } from './field-key.ts';
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
type FieldRevision = { revision: number };
type CacheEntry = {
  dependencies: ReadonlyArray<{
    cache: EntityCache;
    fields: ReadonlySet<string> | null;
    variants?: ReadonlyArray<FieldRevision>;
  }>;
  previous?: WeakRef<object>;
  revision: number;
  thenable?: CachedSnapshot;
};
type EntityCache = {
  fields?: Map<string, number>;
  invalidated: number;
  revision: number;
  variants?: Map<string, FieldRevision>;
  views?: WeakMap<View<any, any>, WeakMap<ViewRef<string>, CacheEntry>>;
};

export default class ViewDataCache {
  constructor(private readonly isEnabled: () => boolean = () => true) {}

  private cache = new Map<EntityId, EntityCache>();
  private revision = 0;

  private entityCache(entityId: EntityId): EntityCache {
    let cache = this.cache.get(entityId);
    if (!cache) {
      cache = { invalidated: 0, revision: 0 };
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
    const viewMap = this.cache.get(entityId)?.views?.get(view);
    if (!viewMap) {
      return null;
    }
    const entry = viewMap.get(ref);
    if (!entry?.thenable) {
      return null;
    }
    if (entry.revision !== this.revision) {
      for (const { cache, fields, variants } of entry.dependencies) {
        if (cache.invalidated > entry.revision) {
          return this.expire(entry);
        }
        if (cache.revision <= entry.revision) {
          continue;
        }
        if (!fields) {
          return this.expire(entry);
        }
        for (const field of fields) {
          if ((cache.fields?.get(field) ?? 0) > entry.revision) {
            return this.expire(entry);
          }
        }
        for (const field of variants ?? []) {
          if (field.revision > entry.revision) {
            return this.expire(entry);
          }
        }
      }
      entry.revision = this.revision;
    }
    return entry.thenable;
  }

  private expire(entry: CacheEntry): null {
    const data = entry.thenable?.value?.data;
    entry.previous = data && typeof data === 'object' ? new WeakRef(data) : undefined;
    entry.thenable = undefined;
    entry.dependencies = [];
    return null;
  }

  /** Recycle a previous result only while a reader still retains it. */
  previous(entityId: EntityId, view: View<any, any>, ref: ViewRef<string>) {
    if (!this.isEnabled()) {
      return undefined;
    }
    const entry = this.cache.get(entityId)?.views?.get(view)?.get(ref);
    return entry?.thenable?.value?.data ?? entry?.previous?.deref();
  }

  set<T extends Entity, S extends Selection<T>, V extends View<T, S>>(
    entityId: EntityId,
    view: V,
    ref: ViewRef<T['__typename']>,
    thenable: FateThenable<ViewSnapshot<T, S>>,
  ) {
    if (!this.isEnabled()) {
      return;
    }
    const entityMap = (this.entityCache(entityId).views ??= new WeakMap());
    let viewMap = entityMap.get(view);
    if (!viewMap) {
      viewMap = new WeakMap();
      entityMap.set(view, viewMap);
    }
    // Coverage already includes every nested entity. Keep dependencies only on
    // this weakly held snapshot instead of accumulating a reverse entity graph.
    const dependencies: Array<CacheEntry['dependencies'][number]> = [];
    let coversEntity = false;
    for (const [id, fields] of thenable.value?.coverage ?? []) {
      coversEntity ||= id === entityId;
      const cache = this.entityCache(id);
      let variants: Array<FieldRevision> | undefined;
      // Only argument variants can be collected individually. Ordinary fields
      // can reuse the snapshot's coverage without allocating revision cells.
      for (const field of fields) {
        if (!field.includes('(')) {
          continue;
        }
        const revisions = (cache.variants ??= new Map());
        let revision = revisions.get(field);
        if (!revision) {
          revision = { revision: 0 };
          revisions.set(field, revision);
        }
        (variants ??= []).push(revision);
      }
      dependencies.push({ cache, fields, variants });
    }
    if (!coversEntity) {
      dependencies.push({ cache: this.entityCache(entityId), fields: null });
    }
    viewMap.set(ref, { dependencies, revision: this.revision, thenable });
  }

  invalidateField(entityId: EntityId, field: string, hash?: string) {
    if (this.cache.has(entityId)) {
      this.invalidate(entityId, [argumentFieldKey(field, hash)]);
    }
  }

  collectFields(entityId: EntityId, fields: ReadonlySet<string>) {
    this.invalidate(entityId, fields);
    const revisions = this.cache.get(entityId)?.variants;
    for (const field of fields) {
      // Old snapshots still see the invalidated revision through their cell.
      revisions?.delete(field);
    }
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
        const field = path.split('.')[0];
        if (field.includes('(')) {
          const variant = cache.variants?.get(field);
          if (variant) {
            variant.revision = revision;
          }
        } else {
          (cache.fields ??= new Map()).set(field, revision);
        }
      }
    }
    if (revision) {
      cache.revision = revision;
    } else {
      cache.invalidated = ++this.revision;
      // Unread parents can retain this revision metadata after the entity is
      // removed. Drop its view storage without allocating a replacement map.
      cache.fields = undefined;
      cache.variants = undefined;
      cache.views = undefined;
      this.cache.delete(entityId);
    }
  }
}
