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
import { toPrismaSelect } from '../prismaSelect.ts';
import { createSourceDefinitions, createSourcePlan } from '../source.ts';

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
      resolve: (_item, deps) => deps.email as string,
      select: {
        email: field('email'),
      },
    }),
    id: true,
  });

  const postView = dataView<{ _count?: { comments: number }; id: string }>('Post')({
    commentCount: computed<{ _count?: { comments: number }; id: string }, number>({
      resolve: (_item, deps) => (deps.count as number) ?? 0,
      select: {
        count: count('comments'),
      },
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

test('toPrismaSelect skips conflicting filtered counts on the same relation', () => {
  const eventView = dataView<{ id: string }>('Event')({
    goingCount: computed<{ id: string }, number>({
      resolve: (_item, deps) => (deps.count as number) ?? 0,
      select: {
        count: count('attendees', {
          where: { status: 'GOING' },
        }),
      },
    }),
    id: true,
    waitlistCount: computed<{ id: string }, number>({
      resolve: (_item, deps) => (deps.count as number) ?? 0,
      select: {
        count: count('attendees', {
          where: { status: 'WAITLIST' },
        }),
      },
    }),
  });

  expect(
    toPrismaSelect(
      createViewPlan({
        select: ['goingCount', 'waitlistCount'],
        view: eventView,
      }),
    ),
  ).toEqual({
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

  const [, , postSource] = createSourceDefinitions([
    {
      view: userView,
    },
    {
      orderBy: [{ direction: 'desc', field: 'id' }],
      view: commentView,
    },
    {
      relations: {
        author: {
          foreignKey: 'id',
          localKey: 'authorId',
        },
        comments: {
          foreignKey: 'postId',
          localKey: 'id',
          orderBy: [{ direction: 'desc', field: 'id' }],
        },
      },
      view: postView,
    },
  ]);

  expect(
    toPrismaSelect(
      createSourcePlan({
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

test('toPrismaSelect applies list order from data view relation fields', () => {
  const commentView = dataView<{ createdAt: Date; id: string }>('Comment')({
    createdAt: true,
    id: true,
  });
  const postView = dataView<{ comments?: Array<{ createdAt: Date; id: string }>; id: string }>(
    'Post',
  )({
    comments: list(commentView, { orderBy: { createdAt: 'asc', id: 'asc' } }),
    id: true,
  });

  const [, postSource] = createSourceDefinitions([
    {
      view: commentView,
    },
    {
      relations: {
        comments: {
          foreignKey: 'postId',
          localKey: 'id',
        },
      },
      view: postView,
    },
  ]);

  expect(
    toPrismaSelect(
      createSourcePlan({
        select: ['comments.createdAt'],
        source: postSource,
      }),
    ),
  ).toEqual({
    comments: {
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        createdAt: true,
        id: true,
      },
    },
    id: true,
  });
});
