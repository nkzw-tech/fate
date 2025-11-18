import { RequestResult, type Request, type RequestOptions } from '@nkzw/fate';
import { use } from 'react';
import { useFateClient } from './context.tsx';

export function useRequest<R extends Request>(
  request: R,
  options?: RequestOptions,
): RequestResult<R> {
  return use(useFateClient().request(request, options));
}
