import type { AppRouter } from '@nkzw/fate-server/src/trpc/root.ts';
import type { Comment, Post, User } from '@nkzw/fate-server/src/trpc/views.ts';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { createClient, createFateTransport, mutation } from 'react-fate';
import env from './env.tsx';

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

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
  updateUser: (client: TRPCClientType) => client.user.update.mutate,
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
    updateUser: mutation<
      User,
      RouterInputs['user']['update'],
      RouterOutputs['user']['update']
    >('User'),
  },
  transport: createFateTransport<AppRouter, typeof mutations>({
    byId: {
      Comment:
        (client: TRPCClientType) =>
        ({
          args,
          ids,
          select,
        }: {
          args?: Record<string, unknown>;
          ids: Array<string | number>;
          select: Array<string>;
        }) =>
          client.comment.byId.query({
            args,
            ids: ids.map(String),
            select,
          }),
      Post:
        (client: TRPCClientType) =>
        ({
          args,
          ids,
          select,
        }: {
          args?: Record<string, unknown>;
          ids: Array<string | number>;
          select: Array<string>;
        }) =>
          client.post.byId.query({
            args,
            ids: ids.map(String),
            select,
          }),
    },
    client: trpcClient,
    lists: {
      categories: (client: TRPCClientType) => client.category.list.query,
      events: (client: TRPCClientType) => client.event.list.query,
      posts: (client: TRPCClientType) => client.post.list.query,
      projects: (client: TRPCClientType) => client.project.list.query,
    },
    mutations,
  }),
  types: [
    { type: 'User' },
    {
      fields: {
        author: { type: 'User' },
        category: { type: 'Category' },
        comments: { listOf: 'Comment' },
        tags: { listOf: 'Tag' },
      },
      type: 'Post',
    },
    {
      fields: { author: { type: 'User' }, post: { type: 'Post' } },
      type: 'Comment',
    },
    {
      fields: { posts: { listOf: 'Post' } },
      type: 'Tag',
    },
    {
      fields: { posts: { listOf: 'Post' } },
      type: 'Category',
    },
    {
      fields: {
        author: { type: 'User' },
        project: { type: 'Project' },
      },
      type: 'ProjectUpdate',
    },
    {
      fields: { owner: { type: 'User' }, updates: { listOf: 'ProjectUpdate' } },
      type: 'Project',
    },
    {
      fields: { event: { type: 'Event' }, user: { type: 'User' } },
      type: 'EventAttendee',
    },
    {
      fields: {
        attendees: { listOf: 'EventAttendee' },
        host: { type: 'User' },
      },
      type: 'Event',
    },
  ],
});
