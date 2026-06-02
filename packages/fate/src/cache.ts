import {
  FateThenable,
  ViewSnapshot,
  type Entity,
  type EntityId,
  type Selection,
  type View,
  type ViewRef,
} from './types.ts';

export default class ViewDataCache {
  private cache = new Map<
    string,
    WeakMap<View<any, any>, WeakMap<ViewRef<string>, FateThenable<ViewSnapshot<any, any>>>>
  >();

  private rootDependencies = new Map<EntityId, Set<EntityId>>();
  private dependencyIndex = new Map<EntityId, Set<EntityId>>();

  clear() {
    this.cache.clear();
    this.rootDependencies.clear();
    this.dependencyIndex.clear();
  }

  get<T extends Entity, S extends Selection<T>, V extends View<T, S>>(
    entityId: EntityId,
    view: V,
    ref: ViewRef<T['__typename']>,
  ): FateThenable<ViewSnapshot<T, S>> | null {
    return this.cache.get(entityId)?.get(view)?.get(ref) ?? null;
  }

  set<T extends Entity, S extends Selection<T>, V extends View<T, S>>(
    entityId: EntityId,
    view: V,
    ref: ViewRef<T['__typename']>,
    thenable: FateThenable<ViewSnapshot<T, S>>,
    dependencies: ReadonlySet<EntityId>,
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

    viewMap.set(ref, thenable);

    let roots = this.rootDependencies.get(entityId);
    if (!roots) {
      roots = new Set();
      this.rootDependencies.set(entityId, roots);
    }

    for (const dependency of dependencies) {
      if (!roots.has(dependency)) {
        roots.add(dependency);
        let dependents = this.dependencyIndex.get(dependency);
        if (!dependents) {
          dependents = new Set();
          this.dependencyIndex.set(dependency, dependents);
        }
        dependents.add(entityId);
      }
    }
  }

  invalidate(entityId: EntityId) {
    this.invalidateDependents(entityId, new Set());
  }

  private invalidateDependents(entityId: EntityId, visited: Set<EntityId>) {
    if (visited.has(entityId)) {
      return;
    }

    visited.add(entityId);

    const dependents = this.dependencyIndex.get(entityId);
    if (dependents) {
      for (const dependent of dependents) {
        this.invalidateDependents(dependent, visited);
      }
    }

    this.delete(entityId);
  }

  private delete(entityId: EntityId) {
    const roots = this.rootDependencies.get(entityId);
    if (roots) {
      for (const dependency of roots) {
        const dependents = this.dependencyIndex.get(dependency);
        if (!dependents) {
          continue;
        }

        dependents.delete(entityId);
        if (dependents.size === 0) {
          this.dependencyIndex.delete(dependency);
        }
      }
      this.rootDependencies.delete(entityId);
    }

    this.cache.delete(entityId);
  }
}
