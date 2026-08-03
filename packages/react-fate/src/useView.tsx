import {
  Deferred,
  EntityId,
  FateThenable,
  isDeferred,
  View,
  ViewData,
  ViewEntity,
  ViewEntityName,
  ViewRef,
  ViewSelection,
  ViewSnapshot,
  ViewTag,
} from '@nkzw/fate';
import { use, useCallback, useDeferredValue, useRef, useSyncExternalStore } from 'react';
import { useFateClient } from './context.tsx';
import { fulfilledThenable, isFulfilledThenable } from './thenable.ts';

type ViewEntityWithTypename<V extends View<any, any>> = ViewEntity<V> & {
  __typename: ViewEntityName<V>;
};

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
export function useView<V extends View<any, any>, R extends ViewRef<ViewEntityName<V>> | null>(
  view: V,
  ref: R,
): R extends null ? null : ViewData<ViewEntityWithTypename<V>, ViewSelection<V>>;
export function useView<
  V extends View<any, any>,
  R extends Deferred<ViewRef<ViewEntityName<V>>> | null,
>(view: V, ref: R): R extends null ? null : ViewData<ViewEntityWithTypename<V>, ViewSelection<V>>;
export function useView<V extends View<any, any>>(
  view: V,
  ref: Deferred<ViewRef<ViewEntityName<V>>> | ViewRef<ViewEntityName<V>> | null,
): ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null;
export function useView<V extends View<any, any>>(
  view: V,
  ref: Deferred<ViewRef<ViewEntityName<V>>> | ViewRef<ViewEntityName<V>> | null,
): ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null {
  const client = useFateClient();
  const isDeferredRef = isDeferred(ref);
  const snapshotRef = useRef<ViewSnapshot<ViewEntity<V>, V[ViewTag]['select']> | null>(null);
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
            snapshotRef.current = cached.thenable.value;
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
          snapshotRef.current = value;
          return thenable;
        }

        mergedSnapshotRef.current = null;
        const value = snapshot.value;
        snapshotRef.current = value;
        return snapshot;
      }

      mergedSnapshotRef.current = null;
      snapshotRef.current = null;
      if (!coverage.length) {
        return snapshot;
      }

      return Promise.resolve(snapshot).then((value) => {
        const resolved = mergeCoverage(value);
        snapshotRef.current = resolved;
        return resolved;
      });
    },
    [client, view],
  );

  const getSnapshot = useCallback(() => {
    if (ref === null) {
      snapshotRef.current = null;
      return nullSnapshot;
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
        snapshotRef.current = {
          coverage: deferredSnapshot.value.coverage,
          data: null as unknown as ViewData<ViewEntity<V>, V[ViewTag]['select']>,
        };
        return fulfilledThenable(snapshotRef.current);
      }

      return readViewSnapshot(
        client.ref(resolvedRef.__typename, resolvedRef.id, view),
        deferredSnapshot.value.coverage,
        deferred,
      );
    }

    if (pendingRef.current?.deferred === ref && pendingRef.current.snapshot === deferredSnapshot) {
      return pendingRef.current.viewSnapshot;
    }

    snapshotRef.current = null;
    const viewSnapshot = Promise.resolve(deferredSnapshot).then((deferredValue) => {
      const resolvedRef = deferredValue.data;
      if (resolvedRef === null) {
        const value = {
          coverage: deferredValue.coverage,
          data: null as unknown as ViewData<ViewEntity<V>, V[ViewTag]['select']>,
        };
        snapshotRef.current = value;
        return value;
      }

      return Promise.resolve(
        readViewSnapshot(
          client.ref(resolvedRef.__typename, resolvedRef.id, view),
          deferredValue.coverage,
          deferred,
        ),
      ).then((value) => {
        snapshotRef.current = value;
        return value;
      });
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
      if (ref === null) {
        snapshotRef.current = null;
        return () => {};
      }

      const subscriptions = new Map<EntityId, () => void>();

      const onChange = () => {
        updateSubscriptions();
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
        if (snapshotRef.current) {
          for (const [entityId, paths] of snapshotRef.current.coverage) {
            subscribe(entityId, paths);
          }

          cleanup(new Set(snapshotRef.current.coverage.map(([id]) => id)));
        }
      };

      updateSubscriptions();

      return () => {
        for (const unsubscribe of subscriptions.values()) {
          unsubscribe();
        }
        subscriptions.clear();
      };
    },
    [client.store, ref],
  );

  const snapshot = use(
    useDeferredValue(useSyncExternalStore(subscribe, getSnapshot, getSnapshot)),
  ) as ViewSnapshot<ViewEntity<V>, ViewSelection<V>> | null;

  return snapshot ? snapshot.data : null;
}
