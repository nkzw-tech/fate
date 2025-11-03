import { QueryResult, type Query } from '@nkzw/fate';
import { use } from 'react';
import { useFateClient } from './context.tsx';

export function useQuery<Q extends Query>(query: Q): QueryResult<Q> {
  const client = useFateClient();
  return use(client.request(query));
}
