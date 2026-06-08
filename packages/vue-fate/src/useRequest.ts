import {
  type FateClient as FateClientT,
  type FateRoots,
  type Request,
  type RequestOptions,
  type RequestResult,
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

type GeneratedFateClient = ReturnType<typeof import('vue-fate/client').createFateClient>;
export type Roots = [GeneratedFateClient] extends [never]
  ? FateRoots
  : GeneratedFateClient extends FateClientT<infer R, any>
    ? R
    : FateRoots;

export type RequestResource<T> = {
  data: ShallowRef<T | null>;
  dispose: () => void;
  error: ShallowRef<unknown>;
  pending: ShallowRef<boolean>;
  ready: () => Promise<T>;
  refresh: () => Promise<T>;
};

const releaseDisposable = (dispose: (() => void) | null) => {
  if (dispose) {
    dispose();
  }
};

/**
 * Declares the data a component or screen needs and exposes it as a Vue resource.
 */
export function useRequest<R extends Request, O extends FateRoots = Roots>(
  request: MaybeRefOrGetter<R>,
  options?: RequestOptions,
): RequestResource<RequestResult<O, R>> {
  const clientSource = getFateClientSource(useFateClient());
  const data = shallowRef<RequestResult<O, R> | null>(null);
  const errorState = shallowRef<unknown>(null);
  const pending = shallowRef(false);
  const mode = options?.mode ?? 'cache-first';
  let disposed = false;
  let activeClient: FateClientT<any, any> | null = null;
  let requestKey: null | string = null;
  let retainDispose: (() => void) | null = null;
  let token = 0;
  let currentPromise: Promise<RequestResult<O, R>> | null = null;

  const cleanupRequest = () => {
    releaseDisposable(retainDispose);
    retainDispose = null;

    if (
      activeClient &&
      requestKey &&
      (mode === 'network-only' || mode === 'stale-while-revalidate')
    ) {
      activeClient.releaseRequestKey(requestKey, mode);
    }
    activeClient = null;
    requestKey = null;
  };

  const execute = () => {
    const currentToken = ++token;
    cleanupRequest();

    const client = clientSource.value;
    const prepared = client.prepareRequestForRender(toValue(request), options);
    activeClient = client;
    requestKey = prepared.requestKey;
    retainDispose = client.retainRequestKey(prepared.requestKey, mode).dispose;
    pending.value = true;
    errorState.value = null;

    currentPromise = Promise.resolve(prepared.promise).then(
      (value) => {
        if (!disposed && currentToken === token) {
          data.value = markRaw(value) as RequestResult<O, R>;
          pending.value = false;
        }
        return value as RequestResult<O, R>;
      },
      (error) => {
        if (!disposed && currentToken === token) {
          errorState.value = error;
          pending.value = false;
        }
        throw error;
      },
    );
    void currentPromise.catch(() => {});

    return currentPromise;
  };

  const stop = watch(
    () => [clientSource.value, toValue(request)] as const,
    () => {
      void execute();
    },
    {
      deep: true,
      immediate: true,
    },
  );

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    stop();
    cleanupRequest();
  };

  onServerPrefetch(() => currentPromise ?? execute());
  onScopeDispose(dispose);

  return {
    data,
    dispose,
    error: errorState,
    pending,
    ready: () => currentPromise ?? execute(),
    refresh: execute,
  };
}
