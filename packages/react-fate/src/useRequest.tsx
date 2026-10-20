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
): RequestResult<O, R> {
  const client = useFateClient();
  const mode = options?.mode ?? 'cache-first';
  const { promise, requestKey } = client.prepareRequestForRender(request, options);

  const observed = useMemo(
    () => ({
      ...client.observeRequestResult(request),
      client,
      mode,
      // A later imperative refresh must not reset the initial Suspense gate.
      promise: isFulfilledThenable(promise)
        ? fulfilledThenable(promise.value)
        : Promise.resolve(promise),
      requestKey,
    }),
    // Equivalent inline selections share the same request identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, mode, promise, requestKey],
  );
  const deferred = useDeferredValue(observed);
  const result = useSyncExternalStore(
    deferred.subscribe,
    deferred.getSnapshot,
    deferred.getSnapshot,
  );

  useEffect(() => {
    const retained = deferred.client.retainRequestKey(deferred.requestKey, deferred.mode);

    return () => {
      retained.dispose();

      if (deferred.mode === 'network-only' || deferred.mode === 'stale-while-revalidate') {
        deferred.client.releaseRequestKey(deferred.requestKey, deferred.mode);
      }
    };
  }, [deferred]);

  use(deferred.promise);
  return result as unknown as RequestResult<O, R>;
}
