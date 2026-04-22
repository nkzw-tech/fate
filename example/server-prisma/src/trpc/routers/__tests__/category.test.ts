import { expect, test, vi } from 'vite-plus/test';
import { router } from '../../init.ts';
import { categoryRouter } from '../category.ts';

test('returns backward Prisma pages in canonical connection order', async () => {
  const findMany = vi
    .fn()
    .mockResolvedValue([{ id: 'category-3' }, { id: 'category-2' }, { id: 'category-1' }]);

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
