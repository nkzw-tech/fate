import type { ClientDefinitionOf, RegisteredClient } from '@nkzw/fate';
import {
  type CheckedRequest,
  FateRoots,
  RequestResult,
  type Request,
  type RequestOptions,
} from '@nkzw/fate';
import { use, useDeferredValue, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useFateClient, useHydrationReader } from './context.tsx';
import { fulfilledThenable, isFulfilledThenable } from './thenable.ts';

type GeneratedFateClient = RegisteredClient<
  ReturnType<typeof import('react-fate/client').createFateClient>
>;
export type Roots = [GeneratedFateClient] extends [never]
  ? FateRoots
  : ClientDefinitionOf<GeneratedFateClient> extends { roots: infer R extends FateRoots }
    ? R
    : FateRoots;

export type UseRequestOptions = Omit<RequestOptions, 'mode'> & {
  mode?: RequestOptions['mode'] | 'cache-only';
};
const cacheOnlyGate = fulfilledThenable(undefined);
const noopSubscribe = () => () => {};
const getClientRender = () => false;
const getHydrationRender = () => true;

/**
 * Declares the data a screen needs and kicks off fetching, suspending while the
 * request resolves.
 *
 * @example
 * const { posts } = useRequest({ posts: { list: PostView } });
 */
export function useRequest<const R extends Request, O extends FateRoots = Roots>(
  request: CheckedRequest<O, R>,
  options?: RequestOptions,
): RequestResult<O, R>;
export function useRequest<const R extends Request, O extends FateRoots = Roots>(
  request: CheckedRequest<O, R>,
  options: UseRequestOptions,
): RequestResult<O, R> | undefined;
export function useRequest<const R extends Request, O extends FateRoots = Roots>(
  request: CheckedRequest<O, R>,
  options?: UseRequestOptions,
): RequestResult<O, R> | undefined {
  const client = useFateClient();
  const hydrationReader = useHydrationReader(client);
  // React switches this consumer to the live request path after it hydrates.
  const hydrating = useSyncExternalStore(
    noopSubscribe,
    getClientRender,
    hydrationReader ? getHydrationRender : getClientRender,
  );
  const mode = options?.mode ?? 'cache-first';
  const cacheOnly = mode === 'cache-only';
  const key = client.getRequestKey(request);
  const timeout = options?.timeout;
  const signal = options?.signal;
  const maxAge = options?.persist?.maxAge;
  const { promise, requestKey } = useMemo(
    () =>
      cacheOnly || hydrating
        ? { promise: cacheOnlyGate, requestKey: key }
        : client.prepareRequestForRender(request, options as RequestOptions),
    // A mounted consumer keeps its preparation even if another consumer releases it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cacheOnly, client, hydrating, key, mode, timeout, signal, maxAge],
  );

  const observed = useMemo(
    () => {
      const observe = (source: typeof client) => {
        if (!cacheOnly) {
          return source.observeRequestResult(request);
        }
        const observer = source.observeRequest(request, { mode: 'cache-only' });
        return { getSnapshot: () => observer.getSnapshot().data, subscribe: observer.subscribe };
      };
      const live = observe(client);
      return {
        ...live,
        client,
        getServerSnapshot: hydrationReader
          ? observe(hydrationReader).getSnapshot
          : live.getSnapshot,
        mode,
        requestPromise: promise,
        retain: () => client.retain(request),
        // A later imperative refresh must not reset the initial Suspense gate.
        promise: isFulfilledThenable(promise)
          ? fulfilledThenable(promise.value)
          : Promise.resolve(promise),
        requestKey,
      };
    },
    // Equivalent inline selections share the same request identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cacheOnly, client, hydrationReader, mode, promise, requestKey],
  );
  const deferred = useDeferredValue(observed);
  const active = cacheOnly ? observed : deferred;
  const result = useSyncExternalStore(
    active.subscribe,
    active.getSnapshot,
    active.getServerSnapshot,
  );

  useEffect(() => {
    if (active.mode === 'cache-only') {
      return;
    }
    const retained = active.retain();

    // Render retries share the preparation until commit. After that this
    // reader keeps its own gate, and a new mount can start a fresh request.
    if (
      active.requestPromise !== cacheOnlyGate &&
      (active.mode === 'network-only' || active.mode === 'stale-while-revalidate')
    ) {
      active.client.releaseRequestKey(active.requestKey, active.mode, active.requestPromise);
    }
    return retained.dispose;
  }, [active]);

  use(active.promise);
  return result as unknown as RequestResult<O, R> | undefined;
}
