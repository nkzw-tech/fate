import {
  type Deferred,
  type EntityId,
  type View,
  type ViewData,
  type ViewEntity,
  type ViewEntityName,
  type ViewRef,
  type ViewSelection,
  type ViewSnapshot,
  type ViewTag,
  isDeferred,
  resolveView,
} from '@nkzw/fate';
import {
  markRaw,
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type ShallowRef,
} from 'vue';
import { getFateClientSource, useFateClient } from './context.ts';
import { fulfilledThenable, isFulfilledThenable } from './thenable.ts';

type ViewEntityWithTypename<V extends View<any, any>> = ViewEntity<V> & {
  __typename: ViewEntityName<V>;
};

export type ViewResource<T> = ShallowRef<T> & {
  dispose: () => void;
  error: ShallowRef<unknown>;
  pending: ShallowRef<boolean>;
  ready: () => Promise<T>;
  refresh: () => Promise<T>;
};

const nullSnapshot = fulfilledThenable(null);
const undefinedSnapshot = fulfilledThenable(undefined);

/**
 * Resolves a reference against a view and subscribes to updates for that selection.
 */
export function useView<
  V extends View<any, any>,
  R extends ViewRef<ViewEntityName<V>> | null | undefined,
>(
  view: V,
  ref: MaybeRefOrGetter<R>,
): ViewResource<
  R extends null | undefined ? R : ViewData<ViewEntityWithTypename<V>, ViewSelection<V>>
>;
export function useView<
  V extends View<any, any>,
  R extends Deferred<ViewRef<ViewEntityName<V>>> | null | undefined,
>(
  view: V,
  ref: MaybeRefOrGetter<R>,
): ViewResource<
  R extends null | undefined ? R : ViewData<ViewEntityWithTypename<V>, ViewSelection<V>>
>;
export function useView<V extends View<any, any>>(
  view: V,
  ref: MaybeRefOrGetter<
    Deferred<ViewRef<ViewEntityName<V>>> | ViewRef<ViewEntityName<V>> | null | undefined
  >,
): ViewResource<ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null | undefined>;
export function useView<V extends View<any, any>>(
  view: V,
  ref: MaybeRefOrGetter<
    Deferred<ViewRef<ViewEntityName<V>>> | ViewRef<ViewEntityName<V>> | null | undefined
  >,
): ViewResource<ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null | undefined> {
  const clientSource = getFateClientSource(useFateClient());
  const data = shallowRef<ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null | undefined>(
    toValue(ref) === undefined ? undefined : null,
  );
  const errorState = shallowRef<unknown>(null);
  const pending = shallowRef(false);
  let disposed = false;
  let activeClient = clientSource.value;
  let snapshot: ViewSnapshot<ViewEntity<V>, V[ViewTag]['select']> | null = null;
  let token = 0;
  let currentPromise: Promise<
    ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null | undefined
  > | null = null;
  const subscriptions = new Map<
    EntityId,
    { paths: ReadonlySet<string>; unsubscribe: () => void }
  >();

  const cleanupSubscriptions = (nextIds: ReadonlySet<EntityId> = new Set()) => {
    for (const [entityId, { unsubscribe }] of subscriptions) {
      if (!nextIds.has(entityId)) {
        unsubscribe();
        subscriptions.delete(entityId);
      }
    }
  };

  const updateSubscriptions = () => {
    if (!snapshot) {
      cleanupSubscriptions();
      return;
    }

    const coverage = new Map<EntityId, Set<string>>();
    for (const [entityId, paths] of snapshot.coverage) {
      const selected = coverage.get(entityId);
      if (selected) {
        for (const path of paths) {
          selected.add(path);
        }
      } else {
        coverage.set(entityId, new Set(paths));
      }
    }

    for (const [entityId, paths] of coverage) {
      const previous = subscriptions.get(entityId);
      if (
        !previous ||
        paths.size !== previous.paths.size ||
        [...paths].some((path) => !previous.paths.has(path))
      ) {
        previous?.unsubscribe();
        subscriptions.set(entityId, {
          paths,
          unsubscribe: activeClient.store.subscribe(entityId, paths, refresh),
        });
      }
    }

    cleanupSubscriptions(new Set(coverage.keys()));
  };

  const readViewSnapshot = (
    viewRef: ViewRef<ViewEntityName<V>>,
    coverage: ViewSnapshot<ViewEntity<V>, V[ViewTag]['select']>['coverage'] = [],
  ) => {
    const viewSnapshot = activeClient.readView<ViewEntity<V>, V[ViewTag]['select'], V>(
      view,
      viewRef,
    );
    const mergeCoverage = (
      value: ViewSnapshot<ViewEntity<V>, V[ViewTag]['select']>,
    ): ViewSnapshot<ViewEntity<V>, V[ViewTag]['select']> => ({
      ...value,
      coverage: coverage.length ? [...coverage, ...value.coverage] : value.coverage,
    });

    if (isFulfilledThenable(viewSnapshot)) {
      return coverage.length ? fulfilledThenable(mergeCoverage(viewSnapshot.value)) : viewSnapshot;
    }

    return Promise.resolve(viewSnapshot).then(mergeCoverage);
  };

  const getSnapshot = () => {
    const currentRef = toValue(ref);
    if (currentRef == null) {
      return currentRef === undefined ? undefinedSnapshot : nullSnapshot;
    }

    if (!isDeferred(currentRef)) {
      return readViewSnapshot(currentRef as ViewRef<ViewEntityName<V>>);
    }

    const deferredSnapshot = activeClient.readDeferred(
      currentRef as Deferred<ViewRef<ViewEntityName<V>>>,
    );
    if (isFulfilledThenable(deferredSnapshot)) {
      const resolvedRef = deferredSnapshot.value.data;
      if (resolvedRef === null) {
        return fulfilledThenable({
          coverage: deferredSnapshot.value.coverage,
          data: null as unknown as ViewData<ViewEntity<V>, V[ViewTag]['select']>,
        });
      }

      return readViewSnapshot(
        activeClient.ref(resolvedRef.__typename, resolvedRef.id, resolveView(view, resolvedRef)),
        deferredSnapshot.value.coverage,
      );
    }

    return Promise.resolve(deferredSnapshot).then((deferredValue) => {
      const resolvedRef = deferredValue.data;
      if (resolvedRef === null) {
        return {
          coverage: deferredValue.coverage,
          data: null as unknown as ViewData<ViewEntity<V>, V[ViewTag]['select']>,
        };
      }

      return readViewSnapshot(
        activeClient.ref(resolvedRef.__typename, resolvedRef.id, resolveView(view, resolvedRef)),
        deferredValue.coverage,
      );
    });
  };

  function refresh() {
    const currentToken = ++token;
    const nextClient = clientSource.value;
    if (nextClient !== activeClient) {
      cleanupSubscriptions();
      snapshot = null;
      activeClient = nextClient;
    }
    pending.value = true;
    errorState.value = null;

    const nextSnapshot = getSnapshot();
    currentPromise = Promise.resolve(nextSnapshot).then(
      (value) => {
        if (!disposed && currentToken === token) {
          snapshot = value ?? null;
          data.value = value ? (markRaw(value.data) as typeof data.value) : value;
          pending.value = false;
          updateSubscriptions();
        }
        return (value ? value.data : value) as
          | ViewData<ViewEntityWithTypename<V>, ViewSelection<V>>
          | null
          | undefined;
      },
      (error) => {
        if (!disposed && currentToken === token) {
          errorState.value = error;
          pending.value = false;
          snapshot = null;
          updateSubscriptions();
        }
        throw error;
      },
    );
    void currentPromise.catch(() => {});

    return currentPromise;
  }

  const stop = watch(
    () => [clientSource.value, toValue(ref)] as const,
    () => {
      void refresh();
    },
    {
      immediate: true,
    },
  );

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    stop();
    cleanupSubscriptions();
  };

  onScopeDispose(dispose);

  return Object.assign(data, {
    dispose,
    error: errorState,
    pending,
    ready: () => currentPromise ?? refresh(),
    refresh,
  }) as ViewResource<ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null | undefined>;
}
