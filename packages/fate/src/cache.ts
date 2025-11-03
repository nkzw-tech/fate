import {
  FateThenable,
  type Entity,
  type EntityId,
  type Selection,
  type View,
  type ViewData,
  type ViewRef,
} from './types.ts';

export default class ViewDataCache {
  private cache = new Map<
    string,
    WeakMap<
      View<any, any>,
      WeakMap<ViewRef<string>, FateThenable<ViewData<any, any>>>
    >
  >();

  get<T extends Entity, S extends Selection<T>, V extends View<T, S>>(
    entityId: EntityId,
    view: V,
    ref: ViewRef<T['__typename']>,
  ): FateThenable<ViewData<T, S>> | null {
    return this.cache.get(entityId)?.get(view)?.get(ref) ?? null;
  }

  set<T extends Entity, S extends Selection<T>, V extends View<T, S>>(
    entityId: EntityId,
    view: V,
    ref: ViewRef<T['__typename']>,
    data: FateThenable<ViewData<T, S>>,
  ) {
    let entityMap = this.cache.get(entityId);
    if (!entityMap) {
      entityMap = new WeakMap();
      this.cache.set(entityId, entityMap);
    }

    let viewMap = entityMap.get(view);
    if (!viewMap) {
      viewMap = new WeakMap();
      entityMap.set(view, viewMap);
    }

    viewMap.set(ref, data);
  }

  delete(entityId: EntityId) {
    this.cache.delete(entityId);
  }
}
