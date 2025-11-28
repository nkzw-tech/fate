import { expect, test } from 'vitest';
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

const createViewRef = <TName extends string>(
  __typename: TName,
  id: string,
): ViewRef<TName> => ({
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

  cache.set(
    dependencyId,
    dependencyView,
    dependencyRef,
    dependencyThenable,
    new Set(),
  );
  cache.set(
    dependentId,
    dependentView,
    dependentRef,
    dependentThenable,
    new Set<EntityId>([dependencyId]),
  );

  expect(cache.get(dependencyId, dependencyView, dependencyRef)).toBe(
    dependencyThenable,
  );
  expect(cache.get(dependentId, dependentView, dependentRef)).toBe(
    dependentThenable,
  );

  cache.invalidate(dependencyId);

  expect(cache.get(dependencyId, dependencyView, dependencyRef)).toBeNull();
  expect(cache.get(dependentId, dependentView, dependentRef)).toBeNull();
});
