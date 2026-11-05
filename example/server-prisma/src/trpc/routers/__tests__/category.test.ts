import { expect, test, vi } from 'vite-plus/test';
import { router } from '../../init.ts';
import { categoryRouter } from '../category.ts';

test('returns backward Prisma pages in canonical connection order', async () => {
  // Prisma returns negative-take results in the requested order.
  const findMany = vi
    .fn()
    .mockResolvedValue([{ id: 'category-1' }, { id: 'category-2' }, { id: 'category-3' }]);

  const appRouter = router({ category: categoryRouter });
  const caller = appRouter.createCaller({
    headers: {},
    prisma: { category: { findMany } } as never,
    sessionUser: null,
  });

  const result = await caller.category.list({
    args: { before: 'category-4', last: 2 },
    select: ['id'],
  });

  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      cursor: { id: 'category-4' },
      skip: 1,
      take: -3,
    }),
  );

  expect(result).toEqual({
    items: [
      {
        cursor: 'category-2',
        node: { id: 'category-2' },
      },
      {
        cursor: 'category-3',
        node: { id: 'category-3' },
      },
    ],
    pagination: {
      hasNext: true,
      hasPrevious: true,
      nextCursor: 'category-3',
      previousCursor: 'category-2',
    },
  });
});

test.each([
  {
    args: { after: 'post-1', first: 2 },
    cursor: 'post-1',
    ids: ['post-2', 'post-3'],
    rows: ['post-2', 'post-3', 'post-4'],
    take: 3,
  },
  {
    args: { before: 'post-5', last: 2 },
    cursor: 'post-5',
    ids: ['post-3', 'post-4'],
    rows: ['post-2', 'post-3', 'post-4'],
    take: -3,
  },
])(
  'keeps both cursors for a nested Prisma page with args $args',
  async ({ args, cursor, ids, rows, take }) => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ id: 'category-1', posts: rows.map((id) => ({ id })) }]);
    const caller = router({ category: categoryRouter }).createCaller({
      headers: {},
      prisma: { category: { findMany } } as never,
      sessionUser: null,
    });

    const categories = await caller.category.byId({
      args: { posts: args },
      ids: ['category-1'],
      select: ['posts.id'],
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          posts: expect.objectContaining({ cursor: { id: cursor }, skip: 1, take }),
        }),
      }),
    );
    expect(categories).toEqual([
      {
        id: 'category-1',
        posts: {
          items: ids.map((id) => ({ cursor: id, node: { id } })),
          pagination: {
            hasNext: true,
            hasPrevious: true,
            nextCursor: ids.at(-1),
            previousCursor: ids[0],
          },
        },
      },
    ]);
  },
);
