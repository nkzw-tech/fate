import type { AppRouter } from '@nkzw/fate-server/src/trpc/root.ts';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { createClient, createFateTransport, mutation } from 'react-fate';
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

const mutations = {
  addComment: (client: TRPCClientType) => client.comment.add.mutate,
  deleteComment: (client: TRPCClientType) => client.comment.delete.mutate,
  likePost: (client: TRPCClientType) => client.post.like.mutate,
  unlikePost: (client: TRPCClientType) => client.post.unlike.mutate,
} as const;

export const fate = createClient({
  mutations: {
    addComment: mutation<
      Comment,
      RouterInputs['comment']['add'],
      RouterOutputs['comment']['add']
    >('Comment'),
    deleteComment: mutation<
      Comment,
      RouterInputs['comment']['delete'],
      RouterOutputs['comment']['delete']
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
    lists: {
      posts: (client: TRPCClientType) => client.post.list.query,
    },
    mutations,
  }),
  types: [
    { type: 'User' },
    {
      fields: { author: { type: 'User' }, comments: { listOf: 'Comment' } },
      type: 'Post',
    },
    {
      fields: { author: { type: 'User' }, post: { type: 'Post' } },
      type: 'Comment',
    },
  ],
});
