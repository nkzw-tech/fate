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
  resolveView,
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
export function useLiveView<
  V extends View<any, any>,
  R extends ViewRef<ViewEntityName<V>> | null | undefined,
>(
  view: V,
  ref: MaybeRefOrGetter<R>,
): ViewResource<
  R extends null | undefined ? R : ViewData<ViewEntityWithTypename<V>, ViewSelection<V>>
>;
export function useLiveView<
  V extends View<any, any>,
  R extends Deferred<ViewRef<ViewEntityName<V>>> | null | undefined,
>(
  view: V,
  ref: MaybeRefOrGetter<R>,
): ViewResource<
  R extends null | undefined ? R : ViewData<ViewEntityWithTypename<V>, ViewSelection<V>>
>;
export function useLiveView<V extends View<any, any>>(
  view: V,
  ref: MaybeRefOrGetter<
    Deferred<ViewRef<ViewEntityName<V>>> | ViewRef<ViewEntityName<V>> | null | undefined
  >,
): ViewResource<ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null | undefined>;
export function useLiveView<V extends View<any, any>>(
  view: V,
  ref: MaybeRefOrGetter<
    Deferred<ViewRef<ViewEntityName<V>>> | ViewRef<ViewEntityName<V>> | null | undefined
  >,
): ViewResource<ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null | undefined> {
  const clientSource = getFateClientSource(useFateClient());
  const viewResource = useView(view, ref);
  const disposeResource = viewResource.dispose;
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
      return currentRef as ViewRef<ViewEntityName<V>> | null | undefined;
    }

    return (
      (await clientSource.value.readDeferred(
        currentRef as Deferred<ViewRef<ViewEntityName<V>>>,
      )) as DeferredSnapshot<ViewRef<ViewEntityName<V>> | null | undefined>
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
        liveUnsubscribe = client.subscribeLiveView(
          view,
          client.ref(resolvedRef.__typename, resolvedRef.id, resolveView(view, resolvedRef)),
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
    disposeResource();
  };

  onScopeDispose(dispose);

  return Object.assign(viewResource, { dispose });
}
