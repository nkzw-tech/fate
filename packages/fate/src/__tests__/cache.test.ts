import { expect, test } from 'vite-plus/test';
import ViewDataCache from '../cache.ts';
import {
  ViewsTag,
  type EntityId,
  type FateThenable,
  type View,
  type ViewRef,
  type ViewSnapshot,
} from '../types.ts';

const createThenable = <T>(value: T): FateThenable<T> =>
  ({
    status: 'fulfilled',
    then(onfulfilled) {
      return Promise.resolve(onfulfilled ? onfulfilled(value) : value);
    },
    value,
  }) as FateThenable<T>;

const createView = (): View<any, any> => ({}) as View<any, any>;

const createViewRef = <TName extends string>(__typename: TName, id: string): ViewRef<TName> => ({
  __typename,
  id,
  [ViewsTag]: new Set<string>(),
});

test('evicts dependents and the dependency when invalidating an entity', () => {
  const cache = new ViewDataCache();
  const dependencyId: EntityId = 'dependency';
  const dependentId: EntityId = 'dependent';

  const dependencyView = createView();
  const dependencyRef = createViewRef('Dependency', 'dependency-ref');
  const dependencySnapshot: ViewSnapshot<any, any> = {
    coverage: [[dependencyId, new Set()]],
    data: { [ViewsTag]: new Set() },
  };
  const dependencyThenable = createThenable(dependencySnapshot);

  const dependentView = createView();
  const dependentRef = createViewRef('Dependent', 'dependent-ref');
  const dependentSnapshot: ViewSnapshot<any, any> = {
    coverage: [
      [dependentId, new Set()],
      [dependencyId, new Set()],
    ],
    data: { [ViewsTag]: new Set() },
  };
  const dependentThenable = createThenable(dependentSnapshot);

  cache.set(dependencyId, dependencyView, dependencyRef, dependencyThenable, new Set());
  cache.set(
    dependentId,
    dependentView,
    dependentRef,
    dependentThenable,
    new Set<EntityId>([dependencyId]),
  );

  expect(cache.get(dependencyId, dependencyView, dependencyRef)).toBe(dependencyThenable);
  expect(cache.get(dependentId, dependentView, dependentRef)).toBe(dependentThenable);

  cache.invalidate(dependencyId);

  expect(cache.get(dependencyId, dependencyView, dependencyRef)).toBeNull();
  expect(cache.get(dependentId, dependentView, dependentRef)).toBeNull();
});

test('invalidates snapshots through their complete nested coverage', () => {
  const cache = new ViewDataCache();
  const rootId: EntityId = 'root';
  const middleId: EntityId = 'middle';
  const leafId: EntityId = 'leaf';

  const rootView = createView();
  const rootRef = createViewRef('Root', 'root-ref');
  const rootSnapshot: ViewSnapshot<any, any> = {
    coverage: [[rootId, new Set()]],
    data: { [ViewsTag]: new Set() },
  };
  const rootThenable = createThenable(rootSnapshot);

  const middleView = createView();
  const middleRef = createViewRef('Middle', 'middle-ref');
  const middleSnapshot: ViewSnapshot<any, any> = {
    coverage: [
      [middleId, new Set()],
      [rootId, new Set()],
    ],
    data: { [ViewsTag]: new Set() },
  };
  const middleThenable = createThenable(middleSnapshot);

  const leafView = createView();
  const leafRef = createViewRef('Leaf', 'leaf-ref');
  const leafSnapshot: ViewSnapshot<any, any> = {
    coverage: [
      [leafId, new Set()],
      [middleId, new Set()],
      [rootId, new Set()],
    ],
    data: { [ViewsTag]: new Set() },
  };
  const leafThenable = createThenable(leafSnapshot);

  cache.set(rootId, rootView, rootRef, rootThenable, new Set());
  cache.set(middleId, middleView, middleRef, middleThenable, new Set<EntityId>([rootId]));
  cache.set(leafId, leafView, leafRef, leafThenable, new Set<EntityId>([middleId, rootId]));

  expect(cache.get(rootId, rootView, rootRef)).toBe(rootThenable);
  expect(cache.get(middleId, middleView, middleRef)).toBe(middleThenable);
  expect(cache.get(leafId, leafView, leafRef)).toBe(leafThenable);

  cache.invalidate(rootId);

  expect(cache.get(rootId, rootView, rootRef)).toBeNull();
  expect(cache.get(middleId, middleView, middleRef)).toBeNull();
  expect(cache.get(leafId, leafView, leafRef)).toBeNull();
});

test('preserves snapshots whose selected dependency fields have not changed', () => {
  const cache = new ViewDataCache();
  const parentView = createView();
  const parentRef = createViewRef('Parent', '1');
  const snapshot = createThenable<ViewSnapshot<any, any>>({
    coverage: [
      ['Parent:1', new Set(['child'])],
      ['Child:2', new Set(['name'])],
    ],
    data: { [ViewsTag]: new Set() },
  });
  cache.set('Parent:1', parentView, parentRef, snapshot, new Set(['Child:2']));
  cache.invalidate('Child:2', ['extra']);
  expect(cache.get('Parent:1', parentView, parentRef)).toBe(snapshot);
  cache.invalidate('Parent:1', ['extra']);
  expect(cache.get('Parent:1', parentView, parentRef)).toBe(snapshot);
  cache.invalidate('Child:2', ['name']);
  expect(cache.get('Parent:1', parentView, parentRef)).toBeNull();
});

test('full invalidation still evicts snapshots after unrelated field changes', () => {
  const cache = new ViewDataCache();
  const selected = createView();
  const ref = createViewRef('User', '1');
  const snapshot = createThenable<ViewSnapshot<any, any>>({
    coverage: [['User:1', new Set(['name'])]],
    data: { [ViewsTag]: new Set() },
  });
  cache.set('User:1', selected, ref, snapshot, new Set());
  cache.invalidate('User:1', ['extra']);
  expect(cache.get('User:1', selected, ref)).toBe(snapshot);
  cache.invalidate('User:1');
  expect(cache.get('User:1', selected, ref)).toBeNull();
});

test('replacing one snapshot drops obsolete dependencies without affecting other views', () => {
  const cache = new ViewDataCache();
  const parentId = 'Parent:1';
  const parentView = createView();
  const otherView = createView();
  const ref = createViewRef('Parent', '1');
  const snapshot = (child: string) =>
    createThenable<ViewSnapshot<any, any>>({
      coverage: [
        [parentId, new Set(['child'])],
        [child, new Set(['name'])],
      ],
      data: { [ViewsTag]: new Set() },
    });
  const first = snapshot('Child:1');
  cache.set('Parent:1', parentView, ref, first, new Set(['Child:1']));
  cache.set('Parent:1', otherView, ref, first, new Set(['Child:1']));
  const next = snapshot('Child:2');
  cache.set('Parent:1', parentView, ref, next, new Set(['Child:2']));
  cache.invalidate('Child:1');
  expect(cache.get('Parent:1', parentView, ref)).toBe(next);
  expect(cache.get('Parent:1', otherView, ref)).toBeNull();
  cache.invalidate('Child:2');
  expect(cache.get('Parent:1', parentView, ref)).toBeNull();
});
