import { computed, count, dataView, list, type Entity } from '@nkzw/fate/server';
import type { CommentRow, PostRow, UserRow } from '../drizzle/schema.ts';

export type CommentItem = CommentRow & {
  author?: UserRow | null;
  post?: PostRow | null;
};

export type PostItem = PostRow & {
  author?: UserRow | null;
  comments?: Array<CommentItem>;
};

export const userDataView = dataView<UserRow>('User')({
  id: true,
  name: true,
  username: true,
});

const basePost = {
  author: userDataView,
  commentCount: computed<PostItem, number>({
    resolve: (_item, deps) => (deps.count as number) ?? 0,
    select: {
      count: count('comments'),
    },
  }),
  content: true,
  id: true,
  likes: true,
  title: true,
} as const;

export const postSummaryDataView = dataView<PostItem>('Post')({
  ...basePost,
});

export const commentDataView = dataView<CommentItem>('Comment')({
  author: userDataView,
  content: true,
  id: true,
  post: postSummaryDataView,
});

export const postDataView = dataView<PostItem>('Post')({
  ...basePost,
  comments: list(commentDataView, { orderBy: { createdAt: 'asc', id: 'asc' } }),
});

export type User = Entity<typeof userDataView, 'User'>;
export type Comment = Entity<
  typeof commentDataView,
  'Comment',
  {
    author: User;
    post: Post;
  }
>;
export type Post = Entity<
  typeof postDataView,
  'Post',
  {
    author: User;
    comments: Array<Comment>;
  }
>;

export const Root = {
  commentSearch: {
    procedure: 'search',
    view: list(commentDataView, { orderBy: { createdAt: 'desc', id: 'desc' } }),
  },
  posts: list(postDataView, { orderBy: { createdAt: 'desc', id: 'desc' } }),
  viewer: userDataView,
};
