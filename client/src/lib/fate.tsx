import type { AppRouter } from '@nkzw/fate-server/src/trpc/root.ts';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { createClient, createFateTransport, mutation } from 'react-fate';
import type { EntityConfig } from 'react-fate';
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

const getId: EntityConfig['key'] = (record: unknown) => {
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

const trpcClient = createTRPCProxyClient<AppRouter>({
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
});

type TRPCClientType = typeof trpcClient;

const listResolvers = {
  posts: (client: TRPCClientType) => client.post.list.query,
} as const;

const mutations = {
  addComment: (client: TRPCClientType) => client.comment.add.mutate,
  likePost: (client: TRPCClientType) => client.post.like.mutate,
  unlikePost: (client: TRPCClientType) => client.post.unlike.mutate,
} as const;

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
  mutations: {
    addComment: mutation<
      Comment,
      RouterInputs['comment']['add'],
      RouterOutputs['comment']['add']
    >('Comment'),
    likePost: mutation<
      Post,
      RouterInputs['post']['like'],
      RouterOutputs['post']['like']
    >('Post'),
    unlikePost: mutation<
      Post,
      RouterInputs['post']['unlike'],
      RouterOutputs['post']['unlike']
    >('Post'),
  },
  transport: createFateTransport<AppRouter, typeof mutations>({
    byId: {
      Comment:
        (client: TRPCClientType) =>
        ({
          ids,
          select,
        }: {
          ids: Array<string | number>;
          select?: Array<string>;
        }) =>
          client.comment.byId.query({ ids: ids.map(String), select }),
      Post:
        (client: TRPCClientType) =>
        ({
          ids,
          select,
        }: {
          ids: Array<string | number>;
          select?: Array<string>;
        }) =>
          client.post.byId.query({ ids: ids.map(String), select }),
    },
    client: trpcClient,
    lists: listResolvers,
    mutations,
  }),
});
