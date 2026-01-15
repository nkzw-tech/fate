import { expect, test, vi } from 'vite-plus/test';
import { router } from '../../init.ts';
import { postRouter } from '../post.ts';

test('returns pagination metadata for comment connections', async () => {
  const findMany = vi.fn().mockResolvedValue([
    {
      comments: [{ id: 'comment-1' }, { id: 'comment-2' }],
      id: 'post-1',
    },
  ]);

  const appRouter = router({ post: postRouter });
  const caller = appRouter.createCaller({
    headers: {},
    prisma: { post: { findMany } } as never,
    sessionUser: null,
  });

  const result = await caller.post.byId({
    args: { comments: { first: 1 } },
    ids: ['post-1'],
    select: ['comments.id'],
  });

  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      select: expect.objectContaining({
        comments: expect.objectContaining({ take: 2 }),
      }),
    }),
  );

  expect(result).toEqual([
    expect.objectContaining({
      comments: {
        items: [
          {
            cursor: 'comment-1',
            node: { id: 'comment-1' },
          },
        ],
        pagination: {
          hasNext: true,
          hasPrevious: false,
          nextCursor: 'comment-1',
          previousCursor: undefined,
        },
      },
      id: 'post-1',
    }),
  ]);
});
