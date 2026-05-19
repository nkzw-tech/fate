import { graphqlMutation } from '@nkzw/fate';
import { dataView, list, type Entity } from '@nkzw/fate/server';

type GraphQLUser = {
  id: string;
  name?: string | null;
  username?: string | null;
};

type GraphQLPost = {
  author?: GraphQLUser | null;
  id: string;
  title: string;
};

export const userDataView = dataView<GraphQLUser>('User')({
  id: true,
  name: true,
  username: true,
});

export const postDataView = dataView<GraphQLPost>('Post')({
  author: userDataView,
  id: true,
  title: true,
});

export type User = Entity<typeof userDataView, 'User'>;
export type Post = Entity<
  typeof postDataView,
  'Post',
  {
    author: User | null;
  }
>;

export const Root = {
  posts: list(postDataView),
  viewer: userDataView,
};

export const fateGraphQL = {
  mutations: {
    'post.like': graphqlMutation<Post, { id: string }, Post>('Post', {
      field: 'postLike',
    }),
  },
  roots: {
    posts: { field: 'posts' },
    viewer: { field: 'viewer' },
  },
} as const;
