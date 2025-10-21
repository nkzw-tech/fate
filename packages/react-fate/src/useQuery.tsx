import { isNodeItem, type FragmentRef, type Query } from '@nkzw/fate';
import { useMemo } from 'react';
import { useFateClient } from './context.tsx';

type QueryResult<Q extends Query> = {
  [K in keyof Q]: Q[K] extends {
    type: infer NodeType extends string;
  }
    ? Array<FragmentRef<NodeType>>
    : Q[K] extends {
          ids: Array<unknown>;
          type: infer NodeType2 extends string;
        }
      ? Array<FragmentRef<NodeType2>>
      : never;
};

export function useQuery<Q extends Query>(query: Q): QueryResult<Q> {
  const client = useFateClient();
  const promise = client.ensureQuery(query);
  if (promise) {
    throw promise;
  }

  const result = useMemo(() => {
    const result: Record<string, unknown> = {};
    for (const [name, item] of Object.entries(query)) {
      if (isNodeItem(item)) {
        result[name] = item.ids.map((id) => client.ref(item.type, id));
      } else {
        const ids = client.store.getList(name) ?? [];
        result[name] = ids.map((id: string) => client.toRef(id));
      }
    }
    return result as QueryResult<Q>;
  }, [client, query]);

  return result;
}
