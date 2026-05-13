import { dataView, list, resolver, type Entity } from '@nkzw/fate/server';
import type {
  Comment as PrismaComment,
  Post as PrismaPost,
  User as PrismaUser,
} from '../prisma/prisma-client/client.ts';

export type CommentItem = PrismaComment & {
  author?: PrismaUser | null;
  post?: PrismaPost | null;
};

export type PostItem = PrismaPost & {
  _count?: { comments: number };
  author?: PrismaUser | null;
  comments?: Array<CommentItem>;
};

export const userDataView = dataView<PrismaUser>('User')({
  id: true,
  name: true,
  username: true,
});

const basePost = {
  author: userDataView,
  commentCount: resolver<PostItem, number>({
    resolve: ({ _count }) => _count?.comments ?? 0,
    select: () => ({
      _count: { select: { comments: true } },
    }),
  }),
  content: true,
  id: true,
  likes: true,
  title: true,
} as const;

const postSummaryDataView = dataView<PostItem>('Post')({
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
  comments: list(commentDataView),
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
  commentSearch: { procedure: 'search', view: list(commentDataView) },
  posts: list(postDataView),
  viewer: userDataView,
};
