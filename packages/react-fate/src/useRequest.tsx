import {
  type FateClient as FateClientT,
  type CheckedRequest,
  FateRoots,
  RequestResult,
  type Request,
  type RequestOptions,
} from '@nkzw/fate';
import { use, useDeferredValue, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useFateClient } from './context.tsx';
import { fulfilledThenable, isFulfilledThenable } from './thenable.ts';

type GeneratedFateClient = ReturnType<typeof import('react-fate/client').createFateClient>;
export type Roots = [GeneratedFateClient] extends [never]
  ? FateRoots
  : GeneratedFateClient extends FateClientT<infer R, any>
    ? R
    : FateRoots;

export type UseRequestOptions = Omit<RequestOptions, 'mode'> & {
  mode?: RequestOptions['mode'] | 'cache-only';
};
const cacheOnlyGate = fulfilledThenable(undefined);

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
  const mode = options?.mode ?? 'cache-first';
  const cacheOnly = mode === 'cache-only';
  const { promise, requestKey } = cacheOnly
    ? { promise: cacheOnlyGate, requestKey: client.getRequestKey(request) }
    : client.prepareRequestForRender(request, options as RequestOptions);

  const observed = useMemo(
    () => {
      const observer = cacheOnly ? client.observeRequest(request, { mode: 'cache-only' }) : null;
      return {
        ...(observer
          ? {
              getSnapshot: () => observer.getSnapshot().data,
              subscribe: observer.subscribe,
            }
          : client.observeRequestResult(request)),
        client,
        mode,
        // A later imperative refresh must not reset the initial Suspense gate.
        promise: isFulfilledThenable(promise)
          ? fulfilledThenable(promise.value)
          : Promise.resolve(promise),
        requestKey,
      };
    },
    // Equivalent inline selections share the same request identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cacheOnly, client, mode, promise, requestKey],
  );
  const deferred = useDeferredValue(observed);
  const active = cacheOnly ? observed : deferred;
  const result = useSyncExternalStore(active.subscribe, active.getSnapshot, active.getSnapshot);

  useEffect(() => {
    if (active.mode === 'cache-only') {
      return;
    }
    const retained = active.client.retainRequestKey(active.requestKey, active.mode);

    return () => {
      retained.dispose();

      if (active.mode === 'network-only' || active.mode === 'stale-while-revalidate') {
        active.client.releaseRequestKey(active.requestKey, active.mode);
      }
    };
  }, [active]);

  use(active.promise);
  return result as unknown as RequestResult<O, R> | undefined;
}
