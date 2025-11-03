import {
  FateThenable,
  type Entity,
  type EntityId,
  type Fragment,
  type FragmentData,
  type FragmentRef,
  type Selection,
} from './types.ts';

export default class FragmentDataCache {
  private cache = new Map<
    string,
    WeakMap<
      Fragment<any, any>,
      WeakMap<FragmentRef<string>, FateThenable<FragmentData<any, any>>>
    >
  >();

  get<T extends Entity, S extends Selection<T>, F extends Fragment<T, S>>(
    entityId: EntityId,
    fragment: F,
    ref: FragmentRef<T['__typename']>,
  ): FateThenable<FragmentData<T, S>> | null {
    return this.cache.get(entityId)?.get(fragment)?.get(ref) ?? null;
  }

  set<T extends Entity, S extends Selection<T>, F extends Fragment<T, S>>(
    entityId: EntityId,
    fragment: F,
    ref: FragmentRef<T['__typename']>,
    data: FateThenable<FragmentData<T, S>>,
  ) {
    let entityMap = this.cache.get(entityId);
    if (!entityMap) {
      entityMap = new WeakMap();
      this.cache.set(entityId, entityMap);
    }

    let fragmentMap = entityMap.get(fragment);
    if (!fragmentMap) {
      fragmentMap = new WeakMap();
      entityMap.set(fragment, fragmentMap);
    }

    fragmentMap.set(ref, data);
  }

  delete(entityId: EntityId) {
    this.cache.delete(entityId);
  }
}
