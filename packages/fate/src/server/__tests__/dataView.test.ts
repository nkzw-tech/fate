import { expect, test } from 'vitest';
import { createResolver, dataView, list, resolver } from '../dataView.ts';

type UserItem = { id: string; name: string; password: string };

test('server views filter unexposed fields from selections', async () => {
  const view = dataView<UserItem>()({
    id: true,
    name: true,
  });

  const selection = createResolver({
    select: ['name', 'password'],
    view,
  });

  expect(selection.select).toEqual({
    id: true,
    name: true,
  });

  const result = await selection.resolve({
    id: 'user-1',
    name: 'Jane',
    password: 'secret',
  });
  expect(result).toEqual({ id: 'user-1', name: 'Jane' });
});

type CategoryItem = {
  _count?: { posts: number };
  id: string;
  postCount?: number;
};

test('resolvers can add prisma selections and compute values', async () => {
  const view = dataView<CategoryItem>()({
    id: true,
    postCount: resolver<CategoryItem>({
      resolve: ({ item }) => item._count?.posts ?? 0,
      select: () => ({
        _count: { select: { posts: true } },
      }),
    }),
  });

  const selection = createResolver({
    select: ['postCount'],
    view,
  });

  expect(selection.select).toEqual({
    _count: { select: { posts: true } },
    id: true,
  });

  const item = await selection.resolve({ _count: { posts: 4 }, id: 'cat-1' });
  expect(item).toEqual({ id: 'cat-1', postCount: 4 });
});

type ChildItem = {
  _count?: { items: number };
  id: string;
  total?: number;
};

type ParentItem = {
  child?: ChildItem | null;
  id: string;
};

test('nested resolvers apply their selections within relations', async () => {
  const childView = dataView<ChildItem>()({
    id: true,
    total: resolver<ChildItem>({
      resolve: ({ item }) => item._count?.items ?? 0,
      select: () => ({
        _count: { select: { items: true } },
      }),
    }),
  });

  const parentView = dataView<ParentItem>()({
    child: childView,
    id: true,
  });

  const selection = createResolver({
    select: ['child.total'],
    view: parentView,
  });

  expect(selection.select).toEqual({
    child: {
      select: {
        _count: { select: { items: true } },
        id: true,
      },
    },
    id: true,
  });

  const item = await selection.resolve({
    child: { _count: { items: 7 }, id: 'child-1' },
    id: 'parent-1',
  });

  expect((item.child as any)?.total).toBe(7);
});

type PostItem = { id: string; secret: string; title: string };

type CommentItem = { id: string; post?: PostItem | null };

test('selecting a relation without nested paths only selects minimal fields', () => {
  const postView = dataView<PostItem>()({
    id: true,
    title: true,
  });

  const commentView = dataView<CommentItem>()({
    id: true,
    post: postView,
  });

  const selection = createResolver({
    select: ['post'],
    view: commentView,
  });

  expect(selection.select).toEqual({
    id: true,
    post: { select: { id: true } },
  });
});

test('relation selections without nested paths do not expose unrequested fields', async () => {
  const postView = dataView<PostItem>()({
    id: true,
    secret: true,
    title: true,
  });

  const commentView = dataView<CommentItem>()({
    id: true,
    post: postView,
  });

  const { resolve } = createResolver({
    select: ['post'],
    view: commentView,
  });

  const item = await resolve({
    id: 'comment-1',
    post: { id: 'post-1', secret: 'hidden', title: 'Hello' },
  });

  expect(item.post).toEqual({ id: 'post-1' });
});

type AuthorItem = { id: string; name: string };

type ReplyItem = { author?: AuthorItem | null; id: string };

type CommentWithRepliesItem = { id: string; replies?: Array<ReplyItem> };

type PostWithDeepRelationsItem = { comments?: Array<CommentWithRepliesItem>; id: string };

test('list fields are wrapped into connections recursively using scoped args', async () => {
  const authorView = dataView<AuthorItem>()({
    id: true,
    name: true,
  });

  const replyView = dataView<ReplyItem>()({
    author: authorView,
    id: true,
  });

  const commentView = dataView<CommentWithRepliesItem>()({
    id: true,
    replies: list(replyView),
  });

  const postView = dataView<PostWithDeepRelationsItem>()({
    comments: list(commentView),
    id: true,
  });

  const { resolve } = createResolver({
    args: { comments: { first: 2, replies: { before: 'reply-2', last: 1 } } },
    select: ['comments.replies.author.name'],
    view: postView,
  });

  const result = await resolve({
    comments: [
      {
        id: 'comment-1',
        replies: [
          { author: { id: 'author-1', name: 'Ada' }, id: 'reply-1' },
          { author: { id: 'author-2', name: 'Bea' }, id: 'reply-2' },
        ],
      },
    ],
    id: 'post-1',
  });

  const commentsConnection = result.comments as any;
  expect(commentsConnection?.items).toHaveLength(1);

  const repliesConnection = commentsConnection?.items[0]?.node?.replies;
  expect(repliesConnection?.items).toHaveLength(1);
  expect(repliesConnection?.items[0]?.node?.author?.name).toBe('Ada');
  expect(repliesConnection?.pagination?.hasPrevious).toBe(false);
});
