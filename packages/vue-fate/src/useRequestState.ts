import type {
  CheckedRequest,
  FateRoots,
  Request,
  RequestResult,
  RequestState,
  RequestStateOptions,
} from '@nkzw/fate';
import {
  markRaw,
  onScopeDispose,
  onServerPrefetch,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type ShallowRef,
} from 'vue';
import { getFateClientSource, useFateClient } from './context.ts';
import type { Roots } from './useRequest.ts';

export type RequestStateResource<T> = ShallowRef<RequestState<T>> & {
  dispose: () => void;
};

/** Observes request state without suspending; disabled and cache-only reads never fetch. */
export function useRequestState<const R extends Request, O extends FateRoots = Roots>(
  request: MaybeRefOrGetter<CheckedRequest<O, R>>,
  options: MaybeRefOrGetter<RequestStateOptions> = {},
): RequestStateResource<RequestResult<O, R>> {
  const clientSource = getFateClientSource(useFateClient());
  const state = shallowRef<RequestState<RequestResult<O, R>>>();
  let unsubscribe: (() => void) | undefined;
  const stop = watch(
    [
      () => clientSource.value,
      () => clientSource.value.getRequestKey(toValue(request)),
      () => toValue(options).enabled !== false,
      () => toValue(options).mode ?? 'cache-first',
      () => toValue(options).persist?.maxAge,
      () => toValue(options).timeout,
      () => toValue(options).signal,
    ],
    ([client, _key, enabled, mode, maxAge, timeout, signal]) => {
      unsubscribe?.();
      const observer = client.observeRequest(toValue(request), {
        enabled,
        mode,
        persist: maxAge === undefined ? undefined : { maxAge },
        signal,
        timeout,
      });
      const update = () => {
        state.value = markRaw(observer.getSnapshot()) as RequestState<RequestResult<O, R>>;
      };
      unsubscribe = observer.subscribe(update);
      update();
    },
    { immediate: true },
  );
  const dispose = () => {
    stop();
    unsubscribe?.();
    unsubscribe = undefined;
  };
  onScopeDispose(dispose);
  onServerPrefetch(() => {
    if (state.value?.isFetching) {
      return state.value.refetch().then(
        () => {},
        () => {},
      );
    }
  });
  return Object.assign(state, { dispose }) as RequestStateResource<RequestResult<O, R>>;
}
