import type { AppRouter } from '@nkzw/fate-server/src/trpc/root.ts';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { createClient, createFateTransport, mutation } from 'react-fate';
import env from './env.tsx';

export type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;

type PostBase = NonNullable<RouterOutputs['post']['byId'][number]>;
type CommentBase = NonNullable<RouterOutputs['comment']['byId'][number]>;
type CategoryBase = NonNullable<RouterOutputs['category']['byId'][number]>;
type ProjectBase = NonNullable<
  RouterOutputs['project']['list']['edges'][number]['node']
>;
type EventBase = NonNullable<RouterOutputs['event']['byId'][number]>;
type TagBase = NonNullable<RouterOutputs['tags']['byId'][number]>;

export type User = {
  __typename: 'User';
  id: string;
  name: string | null;
  username?: string | null;
};

export type Tag = TagBase & {
  __typename: 'Tag';
};

export type Comment = CommentBase & {
  __typename: 'Comment';
  author: User;
};

export type ProjectUpdate = ProjectBase['updates'][0] & {
  __typename: 'ProjectUpdate';
  author: User;
};

export type Project = ProjectBase & {
  __typename: 'Project';
  owner: User;
  updates: Array<ProjectUpdate>;
};

export type EventAttendee = EventBase & {
  __typename: 'EventAttendee';
  user: User;
};

export type Event = EventBase & {
  __typename: 'Event';
  attendees: Array<EventAttendee>;
  host: User;
};

export type Post = PostBase & {
  __typename: 'Post';
  author: User;
  category: Category | null;
  comments: Array<Comment>;
  tags: Array<Tag>;
};

export type Category = CategoryBase & {
  __typename: 'Category';
  posts: Array<Post>;
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
