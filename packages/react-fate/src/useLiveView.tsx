import {
  Deferred,
  resolveView,
  View,
  ViewData,
  ViewEntity,
  ViewEntityName,
  ViewRef,
  ViewSelection,
} from '@nkzw/fate';
import { useEffect, useEffectEvent } from 'react';
import { useFateClient } from './context.tsx';
import { useView } from './useView.tsx';

type ViewEntityWithTypename<V extends View<any, any>> = ViewEntity<V> & {
  __typename: ViewEntityName<V>;
};

import { useDeferredValueSnapshot } from './useViewSnapshots.ts';

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
  const resolvedRef = useDeferredValueSnapshot<ViewRef<ViewEntityName<V>> | null | undefined>(ref);
  const liveRef = resolvedRef
    ? client.ref<ViewEntity<V>>(
        resolvedRef.__typename,
        resolvedRef.id,
        resolveView(view, resolvedRef),
      )
    : null;

  const subscribeLiveView = useEffectEvent(() => {
    if (liveRef === null) {
      return;
    }

    return client.subscribeLiveView(view, liveRef);
  });

  useEffect(() => subscribeLiveView(), [client, view, liveRef]);

  return useView(view, resolvedRef);
}
