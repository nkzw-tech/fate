import { View, ViewData, ViewEntity, ViewEntityName, ViewRef, ViewSelection } from '@nkzw/fate';
import { useEffect, useEffectEvent } from 'react';
import { useFateClient } from './context.tsx';
import { useView } from './useView.tsx';

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
export function useLiveView<V extends View<any, any>, R extends ViewRef<ViewEntityName<V>> | null>(
  view: V,
  ref: R,
): R extends null ? null : ViewData<ViewEntityWithTypename<V>, ViewSelection<V>>;
export function useLiveView<V extends View<any, any>>(
  view: V,
  ref: ViewRef<ViewEntityName<V>> | null,
): ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null {
  const client = useFateClient();
  const liveId = ref?.id;
  const liveType = ref?.__typename;

  const subscribeLiveView = useEffectEvent(() => {
    if (ref === null) {
      return;
    }

    client.assertLiveViewSupport();
    return client.subscribeLiveView(view, ref);
  });

  useEffect(() => subscribeLiveView(), [client, view, liveId, liveType]);

  return useView(view, ref);
}
