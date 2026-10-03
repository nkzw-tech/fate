import {
  Deferred,
  DeferredSnapshot,
  isDeferred,
  resolveView,
  View,
  ViewData,
  ViewEntity,
  ViewEntityName,
  ViewRef,
  ViewSelection,
} from '@nkzw/fate';
import { useEffect } from 'preact/hooks';
import { useFateClient } from './context.ts';
import { useEffectEvent, useThenable } from './hooks.ts';
import { useView } from './useView.ts';

type ViewEntityWithTypename<V extends View<any, any>> = ViewEntity<V> & {
  __typename: ViewEntityName<V>;
};

/**
 * Resolves a reference against a view and subscribes to live server updates for
 * that selection.
 *
 * @example
 * const post = useLiveView(PostView, postRef);
 */
export function useLiveView<
  V extends View<any, any>,
  R extends ViewRef<ViewEntityName<V>> | null | undefined,
>(
  view: V,
  ref: R,
): R extends null | undefined ? R : ViewData<ViewEntityWithTypename<V>, ViewSelection<V>>;
export function useLiveView<
  V extends View<any, any>,
  R extends Deferred<ViewRef<ViewEntityName<V>>> | null | undefined,
>(
  view: V,
  ref: R,
): R extends null | undefined ? R : ViewData<ViewEntityWithTypename<V>, ViewSelection<V>>;
export function useLiveView<V extends View<any, any>>(
  view: V,
  ref: Deferred<ViewRef<ViewEntityName<V>>> | ViewRef<ViewEntityName<V>> | null | undefined,
): ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null | undefined {
  const client = useFateClient();
  const deferredSnapshot = useThenable(
    isDeferred(ref) ? client.readDeferred(ref as Deferred<ViewRef<ViewEntityName<V>>>) : null,
  ) as DeferredSnapshot<ViewRef<ViewEntityName<V>> | null | undefined> | undefined;
  const resolvedRef = deferredSnapshot
    ? deferredSnapshot.data
    : (ref as ViewRef<ViewEntityName<V>> | null | undefined);
  const liveRef = resolvedRef
    ? client.ref(resolvedRef.__typename, resolvedRef.id, resolveView(view, resolvedRef))
    : null;

  const subscribeLiveView = useEffectEvent(() => {
    if (liveRef === null) {
      return;
    }

    return client.subscribeLiveView(view, liveRef);
  });

  useEffect(() => subscribeLiveView(), [client, view, liveRef]);

  return useView(
    view,
    ref as Deferred<ViewRef<ViewEntityName<V>>> | ViewRef<ViewEntityName<V>> | null | undefined,
  );
}
