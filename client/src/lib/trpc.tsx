import { createClient, createFateTransport } from '@nkzw/fate';
import type { EntityConfig } from '@nkzw/fate';
import type { AppRouter } from '@nkzw/fate-server/src/trpc/root.ts';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import env from './env.tsx';

export type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;

type PostBase = NonNullable<RouterOutputs['post']['byId'][number]>;
type CommentBase = NonNullable<RouterOutputs['comment']['byId'][number]>;

type User = {
  __typename: 'User';
  id: string;
  name: string | null;
  username?: string | null;
};

export type Comment = CommentBase & {
  __typename: 'Comment';
  author: User;
};

export type Post = PostBase & {
  __typename: 'Post';
  author: User;
  comments: Array<Comment>;
};

const getId: EntityConfig['key'] = (record) => {
  if (!record || typeof record !== 'object' || !('id' in record)) {
    throw new Error(`fate: Missing 'id' on entity record.`);
  }

  const value = (record as { id: string | number }).id;
  const valueType = typeof value;
  if (valueType !== 'string' && valueType !== 'number') {
    throw new Error(
      `fate: Entity id must be a string or number, received '${valueType}'.`,
    );
  }
  return value;
};

export const fate = createClient({
  entities: [
    { key: getId, type: 'User' },
    {
      fields: { author: { type: 'User' }, comments: { listOf: 'Comment' } },
      key: getId,
      type: 'Post',
    },
    {
      fields: { author: { type: 'User' }, post: { type: 'Post' } },
      key: getId,
      type: 'Comment',
    },
  ],
  transport: createFateTransport<AppRouter>({
    byId: {
      Comment:
        (client) =>
        ({ ids, select }) =>
          client.comment.byId.query({ ids: ids.map(String), select }),
      Post:
        (client) =>
        ({ ids, select }) =>
          client.post.byId.query({ ids: ids.map(String), select }),
    },
    client: createTRPCProxyClient<AppRouter>({
      links: [
        httpBatchLink({
          fetch: (input, init) =>
            fetch(input, {
              ...init,
              credentials: 'include',
            }),
          url: `${env('SERVER_URL')}/trpc`,
        }),
      ],
    }),
    lists: {
      'post.list': (c) => c.post.list.query,
    },
  }),
});
