import {
  type FateClient as FateClientT,
  type CheckedRequest,
  FateRoots,
  RequestResult,
  type Request,
  type RequestOptions,
} from '@nkzw/fate';
import { useEffect } from 'preact/hooks';
import { useFateClient } from './context.ts';
import { useDeferredThenable } from './hooks.ts';

type GeneratedFateClient = ReturnType<typeof import('preact-fate/client').createFateClient>;
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

  useEffect(() => {
    const retained = client.retainRequestKey(requestKey, mode);

    return () => {
      retained.dispose();

      if (mode === 'network-only' || mode === 'stale-while-revalidate') {
        client.releaseRequestKey(requestKey, mode);
      }
    };
  }, [client, mode, requestKey]);

  return useDeferredThenable(promise) as unknown as RequestResult<O, R>;
}
