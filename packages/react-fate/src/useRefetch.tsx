import type { CheckedRequest, Request, RequestOptions, RequestResult } from '@nkzw/fate';
import { useCallback } from 'react';
import { useFateClient } from './context.tsx';
import type { Roots } from './useRequest.tsx';

/** Returns a stable function that refreshes a request without fetching during render. */
export function useRefetch<const R extends Request>(
  request: CheckedRequest<Roots, R>,
  options?: Omit<RequestOptions, 'mode'>,
): () => Promise<RequestResult<Roots, R>> {
  const client = useFateClient();
  const key = client.getRequestKey(request);
  const maxAge = options?.persist?.maxAge;
  return useCallback(
    () =>
      client.request(request, {
        mode: 'network-only',
        persist: maxAge === undefined ? undefined : { maxAge },
      }),
    // Equivalent inline selections share the same request identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, key, maxAge],
  );
}
