import {
  Deferred,
  EntityId,
  FateThenable,
  isDeferred,
  resolveView,
  View,
  ViewData,
  ViewEntity,
  ViewEntityName,
  ViewRef,
  ViewSelection,
  ViewSnapshot,
  ViewTag,
} from '@nkzw/fate';
import { useCallback, useRef } from 'preact/hooks';
import { useFateClient } from './context.ts';
import { useDeferredThenable, useSyncExternalStore } from './hooks.ts';
import { fulfilledThenable, isFulfilledThenable } from './thenable.ts';

type ViewEntityWithTypename<V extends View<any, any>> = ViewEntity<V> & {
  __typename: ViewEntityName<V>;
};

const undefinedSnapshot = fulfilledThenable(undefined);

const nullSnapshot = {
  status: 'fulfilled',
  then<TResult1 = null, TResult2 = never>(
    onfulfilled?: ((value: null) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(null).then(onfulfilled, onrejected);
  },
  value: null,
} satisfies FateThenable<null>;

/**
 * Resolves a reference against a view and subscribes to updates for that selection.
 *
 * @example
 * const post = useView(PostView, postRef);
 */
export function useView<
  V extends View<any, any>,
  R extends ViewRef<ViewEntityName<V>> | null | undefined,
>(
  view: V,
  ref: R,
): R extends null | undefined ? R : ViewData<ViewEntityWithTypename<V>, ViewSelection<V>>;
export function useView<
  V extends View<any, any>,
  R extends Deferred<ViewRef<ViewEntityName<V>>> | null | undefined,
>(
  view: V,
  ref: R,
): R extends null | undefined ? R : ViewData<ViewEntityWithTypename<V>, ViewSelection<V>>;
export function useView<V extends View<any, any>>(
  view: V,
  ref: Deferred<ViewRef<ViewEntityName<V>>> | ViewRef<ViewEntityName<V>> | null | undefined,
): ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null | undefined;
export function useView<V extends View<any, any>>(
  view: V,
  ref: Deferred<ViewRef<ViewEntityName<V>>> | ViewRef<ViewEntityName<V>> | null | undefined,
): ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null | undefined {
  const client = useFateClient();
  const isDeferredRef = isDeferred(ref);
  const mergedSnapshotRef = useRef<{
    cacheKey: unknown;
    resolvedKey: string | null;
    source: ViewSnapshot<ViewEntity<V>, V[ViewTag]['select']>;
    thenable: FateThenable<ViewSnapshot<ViewEntity<V>, V[ViewTag]['select']>>;
  } | null>(null);
  const pendingRef = useRef<{
    deferred: Deferred<ViewRef<ViewEntityName<V>>>;
    snapshot: PromiseLike<unknown>;
    viewSnapshot: PromiseLike<ViewSnapshot<ViewEntity<V>, V[ViewTag]['select']> | null>;
  } | null>(null);

  const readViewSnapshot = useCallback(
    (
      viewRef: ViewRef<ViewEntityName<V>>,
      coverage: ViewSnapshot<ViewEntity<V>, V[ViewTag]['select']>['coverage'] = [],
      cacheKey?: unknown,
    ) => {
      const snapshot = client.readView<ViewEntity<V>, V[ViewTag]['select'], V>(view, viewRef);
      const mergeCoverage = (
        value: ViewSnapshot<ViewEntity<V>, V[ViewTag]['select']>,
      ): ViewSnapshot<ViewEntity<V>, V[ViewTag]['select']> => ({
        ...value,
        coverage: coverage.length ? [...coverage, ...value.coverage] : value.coverage,
      });

      if (isFulfilledThenable(snapshot)) {
        if (coverage.length) {
          const cached = mergedSnapshotRef.current;
          const resolvedKey = `${viewRef.__typename}:${String(viewRef.id)}`;
          if (
            cached?.source === snapshot.value &&
            cached.cacheKey === cacheKey &&
            cached.resolvedKey === resolvedKey
          ) {
            return cached.thenable;
          }

          const value = mergeCoverage(snapshot.value);
          const thenable = fulfilledThenable(value);
          mergedSnapshotRef.current = {
            cacheKey,
            resolvedKey,
            source: snapshot.value,
            thenable,
          };
          return thenable;
        }

        mergedSnapshotRef.current = null;
        return snapshot;
      }

      mergedSnapshotRef.current = null;
      if (!coverage.length) {
        return snapshot;
      }

      return Promise.resolve(snapshot).then(mergeCoverage);
    },
    [client, view],
  );

  const getSnapshot = useCallback((): PromiseLike<
    ViewSnapshot<ViewEntity<V>, V[ViewTag]['select']> | null | undefined
  > => {
    if (ref == null) {
      return ref === undefined ? undefinedSnapshot : nullSnapshot;
    }

    if (!isDeferredRef) {
      pendingRef.current = null;
      return readViewSnapshot(ref as ViewRef<ViewEntityName<V>>);
    }

    const deferred = ref as Deferred<ViewRef<ViewEntityName<V>>>;
    const deferredSnapshot = client.readDeferred(deferred);
    if (isFulfilledThenable(deferredSnapshot)) {
      const resolvedRef = deferredSnapshot.value.data;
      pendingRef.current = null;
      if (resolvedRef === null) {
        return fulfilledThenable({
          coverage: deferredSnapshot.value.coverage,
          data: null as unknown as ViewData<ViewEntity<V>, V[ViewTag]['select']>,
        });
      }

      return readViewSnapshot(
        client.ref(resolvedRef.__typename, resolvedRef.id, resolveView(view, resolvedRef)),
        deferredSnapshot.value.coverage,
        deferred,
      );
    }

    if (pendingRef.current?.deferred === ref && pendingRef.current.snapshot === deferredSnapshot) {
      return pendingRef.current.viewSnapshot;
    }

    const viewSnapshot = Promise.resolve(deferredSnapshot).then((deferredValue) => {
      const resolvedRef = deferredValue.data;
      if (resolvedRef === null) {
        return {
          coverage: deferredValue.coverage,
          data: null as unknown as ViewData<ViewEntity<V>, V[ViewTag]['select']>,
        };
      }

      return readViewSnapshot(
        client.ref(resolvedRef.__typename, resolvedRef.id, resolveView(view, resolvedRef)),
        deferredValue.coverage,
        deferred,
      );
    });

    pendingRef.current = {
      deferred,
      snapshot: deferredSnapshot,
      viewSnapshot,
    };
    return viewSnapshot;
  }, [client, view, ref, isDeferredRef, readViewSnapshot]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (ref == null) {
        return () => {};
      }

      const subscriptions = new Map<EntityId, () => void>();
      let disposed = false;
      let pendingSnapshot: PromiseLike<unknown> | null = null;

      const onChange = () => {
        try {
          updateSubscriptions();
        } catch {
          // The component must read the snapshot error itself so an error boundary can
          // handle it, including when this callback runs after a pending read.
        }
        onStoreChange();
      };

      const subscribe = (entityId: EntityId, paths: ReadonlySet<string>) => {
        if (!subscriptions.has(entityId)) {
          subscriptions.set(entityId, client.store.subscribe(entityId, paths, onChange));
        }
      };

      const cleanup = (nextIds: ReadonlySet<EntityId>) => {
        for (const [entityId, unsubscribe] of subscriptions) {
          if (!nextIds.has(entityId)) {
            unsubscribe();
            subscriptions.delete(entityId);
          }
        }
      };

      const updateSubscriptions = () => {
        const snapshot = getSnapshot();
        if (!isFulfilledThenable(snapshot)) {
          if (pendingSnapshot !== snapshot) {
            pendingSnapshot = snapshot;
            // Refresh coverage when loading finishes, even if no entity was
            // available to subscribe to when this subscription started.
            Promise.resolve(snapshot).then(
              () => {
                if (!disposed && pendingSnapshot === snapshot) {
                  onChange();
                }
              },
              () => {
                if (!disposed && pendingSnapshot === snapshot) {
                  onStoreChange();
                }
              },
            );
          }
          return;
        }

        pendingSnapshot = null;
        if (snapshot.value) {
          for (const [entityId, paths] of snapshot.value.coverage) {
            subscribe(entityId, paths);
          }

          cleanup(new Set(snapshot.value.coverage.map(([id]) => id)));
        }
      };

      updateSubscriptions();

      return () => {
        disposed = true;
        for (const unsubscribe of subscriptions.values()) {
          unsubscribe();
        }
        subscriptions.clear();
      };
    },
    [client.store, getSnapshot, ref],
  );

  const snapshot = useDeferredThenable(useSyncExternalStore(subscribe, getSnapshot)) as
    | ViewSnapshot<ViewEntity<V>, ViewSelection<V>>
    | null
    | undefined;

  return snapshot ? snapshot.data : snapshot;
}
