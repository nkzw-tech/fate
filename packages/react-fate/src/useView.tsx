import {
  __FateEntityBrand,
  __FateSelectionBrand,
  EntityId,
  View,
  ViewData,
  ViewRef,
  ViewSnapshot,
  ViewTag,
} from '@nkzw/fate';
import { use, useCallback, useRef, useSyncExternalStore } from 'react';
import { useFateClient } from './context.tsx';

type ViewEntity<V> = V extends { readonly [__FateEntityBrand]?: infer T }
  ? T
  : never;

type ViewEntityName<V> =
  ViewEntity<V> extends { __typename: infer N }
    ? N extends string
      ? N
      : never
    : never;

type ViewSelection<V> = V extends {
  readonly [__FateSelectionBrand]?: infer S;
}
  ? S
  : never;

export function useView<V extends View<any, any>>(
  view: V,
  ref: ViewRef<ViewEntityName<V>>,
): ViewData<ViewEntity<V>, ViewSelection<V>> {
  const client = useFateClient();

  const idRef = useRef<ReadonlySet<EntityId> | null>(null);
  const getSnapshot = useCallback(() => {
    const snapshot = client.readView<ViewEntity<V>, V[ViewTag]['select'], V>(
      view,
      ref,
    );
    idRef.current = snapshot.status === 'fulfilled' ? snapshot.value.ids : null;
    return snapshot;
  }, [client, view, ref]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const subscriptions = new Map<EntityId, () => void>();

      const onChange = () => {
        updateSubscriptions();
        onStoreChange();
      };

      const subscribe = (entityId: EntityId) => {
        if (!subscriptions.has(entityId)) {
          subscriptions.set(
            entityId,
            client.store.subscribe(entityId, onChange),
          );
        }
      };

      const cleanupObsolete = (nextIds: ReadonlySet<EntityId>) => {
        for (const [entityId, unsubscribe] of subscriptions) {
          if (!nextIds.has(entityId)) {
            unsubscribe();
            subscriptions.delete(entityId);
          }
        }
      };

      const updateSubscriptions = () => {
        if (!idRef.current) {
          return;
        }

        for (const entityId of idRef.current) {
          subscribe(entityId);
        }

        cleanupObsolete(idRef.current);
      };

      updateSubscriptions();

      return () => {
        for (const unsubscribe of subscriptions.values()) {
          unsubscribe();
        }
        subscriptions.clear();
      };
    },
    [client.store],
  );

  return (
    use(
      useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
    ) as ViewSnapshot<ViewEntity<V>, ViewSelection<V>>
  ).data;
}
