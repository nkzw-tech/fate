import { expect, test } from 'vitest';
import { createDataViewSelection, dataView, resolver } from '../dataView.ts';

type UserItem = { id: string; name: string; password: string };

test('server views filter unexposed fields from selections', async () => {
  const view = dataView<UserItem>()({
    id: true,
    name: true,
  });

  const selection = createDataViewSelection<UserItem>({
    paths: ['name', 'password'],
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
  expect(result).toEqual({ id: 'user-1', name: 'Jane', password: 'secret' });
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

  const selection = createDataViewSelection<CategoryItem>({
    paths: ['postCount'],
    view,
  });

  expect(selection.select).toEqual({
    _count: { select: { posts: true } },
    id: true,
  });

  const item = await selection.resolve({ _count: { posts: 4 }, id: 'cat-1' });
  expect(item.postCount).toBe(4);
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

  const selection = createDataViewSelection<ParentItem>({
    paths: ['child.total'],
    view: parentView,
  });

  expect(selection.select).toEqual({
    child: {
      select: {
        _count: { select: { items: true } },
      },
    },
    id: true,
  });

  const item = await selection.resolve({
    child: { _count: { items: 7 }, id: 'child-1' },
    id: 'parent-1',
  });

  expect(item.child?.total).toBe(7);
});

type PostItem = { id: string; secret: string; title: string };

type CommentItem = { id: string; post?: PostItem | null };

test('selecting a relation without nested paths respects the child view', () => {
  const postView = dataView<PostItem>()({
    id: true,
    title: true,
  });

  const commentView = dataView<CommentItem>()({
    id: true,
    post: postView,
  });

  const selection = createDataViewSelection<CommentItem>({
    paths: ['post'],
    view: commentView,
  });

  expect(selection.select).toEqual({
    id: true,
    post: { select: { id: true, title: true } },
  });
});
