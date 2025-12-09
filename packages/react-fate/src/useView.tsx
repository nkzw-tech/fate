import {
  EntityId,
  FateThenable,
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

type ViewEntityWithTypename<V extends View<any, any>> = ViewEntity<V> & {
  __typename: ViewEntityName<V>;
};

const nullSnapshot = {
  status: 'fulfilled' as const,
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
export function useView<V extends View<any, any>>(
  view: V,
  ref: ViewRef<ViewEntityName<V>> | null,
): ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null {
  const client = useFateClient();

  const snapshotRef = useRef<ViewSnapshot<ViewEntity<V>, V[ViewTag]['select']> | null>(null);

  const getSnapshot = useCallback(() => {
    if (ref === null) {
      snapshotRef.current = null;
      return nullSnapshot;
    }

    const snapshot = client.readView<ViewEntity<V>, V[ViewTag]['select'], V>(view, ref);
    snapshotRef.current = snapshot.status === 'fulfilled' ? snapshot.value : null;
    return snapshot;
  }, [client, view, ref]);

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
