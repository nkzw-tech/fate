import { RequestResult, type Request, type RequestOptions } from '@nkzw/fate';
import { FateRoots } from '@nkzw/fate';
import { use, useDeferredValue, useEffect } from 'react';
import { useFateClient } from './context.tsx';
import { ClientRoots } from './index.tsx';

export type Roots = keyof ClientRoots extends never ? FateRoots : ClientRoots;

/**
 * Declares the data a screen needs and kicks off fetching, suspending while the
 * request resolves.
 *
 * @example
 * const { posts } = useRequest({ posts: { list: PostView } });
 */
export function useRequest<R extends Request, O extends FateRoots = Roots>(
  request: R,
  options?: RequestOptions,
): RequestResult<O, R> {
  const client = useFateClient();
  const promise = client.request(request, options);
  const mode = options?.mode ?? 'cache-first';

  useEffect(() => {
    const retained = client.retain(request);

    return () => {
      retained.dispose();

      if (mode === 'network-only' || mode === 'stale-while-revalidate') {
        client.releaseRequest(request, mode);
      }
    };
  }, [client, mode, request]);

  return use(useDeferredValue(promise)) as unknown as RequestResult<O, R>;
}
