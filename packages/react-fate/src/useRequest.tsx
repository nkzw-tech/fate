import { RequestResult, type Request } from '@nkzw/fate';
import { use } from 'react';
import { useFateClient } from './context.tsx';

export function useRequest<R extends Request>(request: R): RequestResult<R> {
  const client = useFateClient();
  return use(client.request(request));
}
