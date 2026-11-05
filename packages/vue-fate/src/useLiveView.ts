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
import { isFulfilledThenable } from './thenable.ts';
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
  let deferredSubscriptions: Array<() => void> = [];
  let subscribedClient: typeof clientSource.value | undefined;
  let subscribedRef: ViewRef<ViewEntityName<V>> | undefined;
  let disposed = false;
  let token = 0;

  const cleanupLiveSubscription = () => {
    liveUnsubscribe?.();
    liveUnsubscribe = undefined;
  };

  const cleanupDeferredSubscriptions = () => {
    deferredSubscriptions.forEach((unsubscribe) => unsubscribe());
    deferredSubscriptions = [];
  };

  const subscribe = () => {
    const currentToken = ++token;
    const client = clientSource.value;
    const currentRef = toValue(ref);
    const update = (
      resolvedRef: ViewRef<ViewEntityName<V>> | null | undefined,
      coverage: DeferredSnapshot<unknown>['coverage'] = [],
    ) => {
      if (disposed || currentToken !== token) {
        return;
      }
      cleanupDeferredSubscriptions();
      deferredSubscriptions = coverage.map(([id, paths]) =>
        client.store.subscribe(id, paths, () => {
          queueMicrotask(() => {
            if (!disposed && token === currentToken) {
              subscribe();
            }
          });
        }),
      );

      const liveRef = resolvedRef
        ? client.ref(resolvedRef.__typename, resolvedRef.id, resolveView(view, resolvedRef))
        : undefined;
      if (client === subscribedClient && liveRef === subscribedRef) {
        return;
      }
      cleanupLiveSubscription();
      liveUnsubscribe = liveRef ? client.subscribeLiveView(view, liveRef) : undefined;
      subscribedClient = client;
      subscribedRef = liveRef;
    };
    const fail = (error: unknown) => {
      if (!disposed && currentToken === token) {
        viewResource.error.value = error;
        viewResource.pending.value = false;
      }
    };

    try {
      if (!isDeferred(currentRef)) {
        update(currentRef as ViewRef<ViewEntityName<V>> | null | undefined);
        return;
      }
      const snapshot = client.readDeferred(
        currentRef as Deferred<ViewRef<ViewEntityName<V>> | null | undefined>,
      );
      if (isFulfilledThenable(snapshot)) {
        update(snapshot.value.data, snapshot.value.coverage);
      } else {
        void Promise.resolve(snapshot)
          .then(({ data, coverage }) => update(data, coverage))
          .catch(fail);
      }
    } catch (error) {
      fail(error);
    }
  };

  const stop = watch(
    () => [clientSource.value, toValue(ref)] as const,
    () => {
      cleanupDeferredSubscriptions();
      cleanupLiveSubscription();
      subscribedClient = undefined;
      subscribedRef = undefined;
      subscribe();
    },
    { immediate: true },
  );

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    token++;
    stop();
    cleanupDeferredSubscriptions();
    cleanupLiveSubscription();
    disposeResource();
  };

  onScopeDispose(dispose);

  return Object.assign(viewResource, { dispose });
}
