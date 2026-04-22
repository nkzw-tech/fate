import { expect, test } from 'vite-plus/test';
import {
  computed,
  count,
  createResolver,
  createViewPlan,
  dataView,
  field,
  list,
  resolver,
} from '../dataView.ts';
import { prismaSelect } from '../prismaSelect.ts';
import { toPrismaSelect } from '../prismaSelect.ts';
import { createExecutionPlan, defineSource, desc } from '../source.ts';

test('prismaSelect applies pagination args to relation selections', () => {
  const select = prismaSelect(['comments.id'], { comments: { first: 2 } });

  expect(select).toEqual({
    comments: {
      select: { id: true },
      take: 3,
    },
    id: true,
  });
});

test('prismaSelect maps cursor args to Prisma pagination options', () => {
  const select = prismaSelect(['comments.id'], {
    comments: { after: 'cursor-1', first: 3 },
  });

  expect(select).toEqual({
    comments: {
      cursor: { id: 'cursor-1' },
      select: { id: true },
      skip: 1,
      take: 4,
    },
    id: true,
  });
});

test('prismaSelect maps backward pagination args to Prisma options', () => {
  const select = prismaSelect(['comments.id'], {
    comments: { before: 'cursor-2', last: 2 },
  });

  expect(select).toEqual({
    comments: {
      cursor: { id: 'cursor-2' },
      select: { id: true },
      skip: 1,
      take: -3,
    },
    id: true,
  });
});

test('toPrismaSelect matches createResolver output for view plans', () => {
  type CategoryItem = {
    _count?: { posts: number };
    id: string;
    postCount?: number;
  };

  const categoryView = dataView<CategoryItem>('Category')({
    id: true,
    postCount: resolver<CategoryItem>({
      resolve: ({ _count }) => _count?.posts ?? 0,
      select: () => ({
        _count: { select: { posts: true } },
      }),
    }),
  });

  const plan = createViewPlan({
    select: ['postCount'],
    view: categoryView,
  });

  expect(toPrismaSelect(plan)).toEqual(
    createResolver({
      select: ['postCount'],
      view: categoryView,
    }).select,
  );
});

test('toPrismaSelect includes computed dependencies', () => {
  const userView = dataView<{ email: string; id: string }>('User')({
    email: computed<{ email: string; id: string }, string>({
      needs: {
        email: field('email'),
      },
      resolve: (_item, deps) => deps.email as string,
    }),
    id: true,
  });

  const postView = dataView<{ _count?: { comments: number }; id: string }>('Post')({
    commentCount: computed<{ _count?: { comments: number }; id: string }, number>({
      needs: {
        count: count('comments'),
      },
      resolve: (_item, deps) => (deps.count as number) ?? 0,
    }),
    id: true,
  });

  expect(
    toPrismaSelect(
      createViewPlan({
        select: ['email'],
        view: userView,
      }),
    ),
  ).toEqual({
    email: true,
    id: true,
  });

  expect(
    toPrismaSelect(
      createViewPlan({
        select: ['commentCount'],
        view: postView,
      }),
    ),
  ).toEqual({
    _count: { select: { comments: true } },
    id: true,
  });
});

test('toPrismaSelect skips orderBy for singular relations', () => {
  const userView = dataView<{ id: string; name: string }>('User')({
    id: true,
    name: true,
  });
  const commentView = dataView<{ id: string }>('Comment')({
    id: true,
  });
  const postView = dataView<{
    author?: { id: string; name: string } | null;
    comments?: Array<{ id: string }>;
    id: string;
  }>('Post')({
    author: userView,
    comments: list(commentView),
    id: true,
  });

  const userSource = defineSource(userView, {
    id: 'id',
  });
  const commentSource = defineSource(commentView, {
    id: 'id',
    orderBy: [desc('id')],
  });
  const postSource = defineSource(postView, {
    id: 'id',
    relations: {
      author: {
        foreignKey: 'id',
        kind: 'one',
        localKey: 'authorId',
        source: () => userSource,
      },
      comments: {
        foreignKey: 'postId',
        kind: 'many',
        localKey: 'id',
        orderBy: [desc('id')],
        source: () => commentSource,
      },
    },
  });

  expect(
    toPrismaSelect(
      createExecutionPlan({
        select: ['author.name', 'comments.id'],
        source: postSource,
      }),
    ),
  ).toEqual({
    author: {
      select: {
        id: true,
        name: true,
      },
    },
    comments: {
      orderBy: [{ id: 'desc' }],
      select: {
        id: true,
      },
    },
    id: true,
  });
});
