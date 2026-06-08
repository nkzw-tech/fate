import {
  type Deferred,
  type DeferredSnapshot,
  type View,
  type ViewData,
  type ViewEntity,
  type ViewEntityName,
  type ViewRef,
  type ViewSelection,
  isDeferred,
} from '@nkzw/fate';
import { onScopeDispose, toValue, watch, type MaybeRefOrGetter } from 'vue';
import { getFateClientSource, useFateClient } from './context.ts';
import { useView, type ViewResource } from './useView.ts';

type ViewEntityWithTypename<V extends View<any, any>> = ViewEntity<V> & {
  __typename: ViewEntityName<V>;
};

/**
 * Resolves a reference against a view and subscribes to live server updates for that selection.
 */
export function useLiveView<V extends View<any, any>, R extends ViewRef<ViewEntityName<V>> | null>(
  view: V,
  ref: MaybeRefOrGetter<R>,
): ViewResource<R extends null ? null : ViewData<ViewEntityWithTypename<V>, ViewSelection<V>>>;
export function useLiveView<
  V extends View<any, any>,
  R extends Deferred<ViewRef<ViewEntityName<V>>> | null,
>(
  view: V,
  ref: MaybeRefOrGetter<R>,
): ViewResource<R extends null ? null : ViewData<ViewEntityWithTypename<V>, ViewSelection<V>>>;
export function useLiveView<V extends View<any, any>>(
  view: V,
  ref: MaybeRefOrGetter<Deferred<ViewRef<ViewEntityName<V>>> | ViewRef<ViewEntityName<V>> | null>,
): ViewResource<ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null>;
export function useLiveView<V extends View<any, any>>(
  view: V,
  ref: MaybeRefOrGetter<Deferred<ViewRef<ViewEntityName<V>>> | ViewRef<ViewEntityName<V>> | null>,
): ViewResource<ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null> {
  const clientSource = getFateClientSource(useFateClient());
  const viewResource = useView(view, ref);
  let liveUnsubscribe: (() => void) | undefined;
  let disposed = false;
  let token = 0;

  const cleanupLiveSubscription = () => {
    liveUnsubscribe?.();
    liveUnsubscribe = undefined;
  };

  const resolveRef = async () => {
    const currentRef = toValue(ref);
    if (!isDeferred(currentRef)) {
      return currentRef as ViewRef<ViewEntityName<V>> | null;
    }

    return (
      (await clientSource.value.readDeferred(
        currentRef as Deferred<ViewRef<ViewEntityName<V>>>,
      )) as DeferredSnapshot<ViewRef<ViewEntityName<V>> | null>
    ).data;
  };

  const subscribe = () => {
    const currentToken = ++token;
    cleanupLiveSubscription();

    void resolveRef()
      .then((resolvedRef) => {
        if (disposed || currentToken !== token || !resolvedRef) {
          return;
        }

        const client = clientSource.value;
        client.assertLiveViewSupport();
        liveUnsubscribe = client.subscribeLiveView(
          view,
          client.ref(resolvedRef.__typename, resolvedRef.id, view),
        );
      })
      .catch((error: unknown) => {
        if (!disposed && currentToken === token) {
          viewResource.error.value = error;
          viewResource.pending.value = false;
        }
      });
  };

  const stop = watch(() => [clientSource.value, toValue(ref)] as const, subscribe, {
    immediate: true,
  });

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    token++;
    stop();
    cleanupLiveSubscription();
    viewResource.dispose();
  };

  onScopeDispose(dispose);

  return Object.assign(viewResource, { dispose });
}
