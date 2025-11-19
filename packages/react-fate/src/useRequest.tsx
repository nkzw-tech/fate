import { RequestResult, type Request, type RequestOptions } from '@nkzw/fate';
import { use, useEffect } from 'react';
import { useFateClient } from './context.tsx';

export function useRequest<R extends Request>(
  request: R,
  options?: RequestOptions,
): RequestResult<R> {
  const client = useFateClient();
  const promise = client.request(request, options);
  const mode = options?.mode ?? 'store-or-network';

  useEffect(() => {
    if (mode === 'network' || mode === 'store-and-network') {
      return () => {
        client.releaseRequest(request, mode);
      };
    }
  }, [client, mode, request]);

  return use(promise);
}
