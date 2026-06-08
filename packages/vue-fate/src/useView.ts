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

/**
 * Resolves a reference against a view and subscribes to updates for that selection.
 */
export function useView<V extends View<any, any>, R extends ViewRef<ViewEntityName<V>> | null>(
  view: V,
  ref: MaybeRefOrGetter<R>,
): ViewResource<R extends null ? null : ViewData<ViewEntityWithTypename<V>, ViewSelection<V>>>;
export function useView<
  V extends View<any, any>,
  R extends Deferred<ViewRef<ViewEntityName<V>>> | null,
>(
  view: V,
  ref: MaybeRefOrGetter<R>,
): ViewResource<R extends null ? null : ViewData<ViewEntityWithTypename<V>, ViewSelection<V>>>;
export function useView<V extends View<any, any>>(
  view: V,
  ref: MaybeRefOrGetter<Deferred<ViewRef<ViewEntityName<V>>> | ViewRef<ViewEntityName<V>> | null>,
): ViewResource<ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null>;
export function useView<V extends View<any, any>>(
  view: V,
  ref: MaybeRefOrGetter<Deferred<ViewRef<ViewEntityName<V>>> | ViewRef<ViewEntityName<V>> | null>,
): ViewResource<ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null> {
  const clientSource = getFateClientSource(useFateClient());
  const data = shallowRef<ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null>(null);
  const errorState = shallowRef<unknown>(null);
  const pending = shallowRef(false);
  let disposed = false;
  let activeClient = clientSource.value;
  let snapshot: ViewSnapshot<ViewEntity<V>, V[ViewTag]['select']> | null = null;
  let token = 0;
  let currentPromise: Promise<ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null> | null =
    null;
  const subscriptions = new Map<EntityId, () => void>();

  const cleanupSubscriptions = (nextIds: ReadonlySet<EntityId> = new Set()) => {
    for (const [entityId, unsubscribe] of subscriptions) {
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

    for (const [entityId, paths] of snapshot.coverage) {
      if (!subscriptions.has(entityId)) {
        subscriptions.set(entityId, activeClient.store.subscribe(entityId, paths, refresh));
      }
    }

    cleanupSubscriptions(new Set(snapshot.coverage.map(([id]) => id)));
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
    if (currentRef === null) {
      return nullSnapshot;
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
        activeClient.ref(resolvedRef.__typename, resolvedRef.id, view),
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
        activeClient.ref(resolvedRef.__typename, resolvedRef.id, view),
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
          snapshot = value;
          data.value = value ? (markRaw(value.data) as typeof data.value) : null;
          pending.value = false;
          updateSubscriptions();
        }
        return (value ? value.data : null) as ViewData<
          ViewEntityWithTypename<V>,
          ViewSelection<V>
        > | null;
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
  }) as ViewResource<ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null>;
}
