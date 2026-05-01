import { beforeEach, expect, test, vi } from 'vite-plus/test';

const { deleteCommentRecord, deleteEdge, fetchById } = vi.hoisted(() => ({
  deleteCommentRecord: vi.fn(),
  deleteEdge: vi.fn(),
  fetchById: vi.fn(),
}));

vi.mock('../../../drizzle/queries.ts', () => ({
  createCommentRecord: vi.fn(),
  deleteCommentRecord,
}));

vi.mock('../../init.ts', async () => {
  const { initTRPC } = await import('@trpc/server');
  const { createResolver } = await import('@nkzw/fate/server');
  const { commentDataView, postDataView } = await import('../../views.ts');
  const t = initTRPC.context<any>().create();

  return {
    fate: {
      connection: vi.fn(() => t.procedure.query(() => null)),
      createPlan: vi.fn(({ view, ...options }) =>
        createResolver({
          ...options,
          view: view === postDataView ? postDataView : commentDataView,
        }),
      ),
      fetchById,
      procedures: vi.fn(() => ({})),
    },
    live: {
      connection: vi.fn(() => ({ deleteEdge })),
      update: vi.fn(),
    },
    middleware: t.middleware,
    procedure: t.procedure,
    router: t.router,
  };
});

import { router } from '../../init.ts';
import { commentRouter } from '../comment.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

test('delete returns the post relation after the comment has been removed', async () => {
  fetchById
    .mockResolvedValueOnce({
      authorId: 'user-1',
      content: 'hello',
      id: 'comment-1',
      post: {
        _count: { comments: 3 },
        id: 'post-1',
        title: 'Post title',
      },
      postId: 'post-1',
    })
    .mockResolvedValueOnce({
      _count: { comments: 2 },
      id: 'post-1',
      title: 'Post title',
    });

  const appRouter = router({ comment: commentRouter });
  const caller = appRouter.createCaller({
    db: {} as never,
    headers: {},
    sessionUser: { id: 'user-1', role: '', username: 'user-1' },
  });

  const result = await caller.comment.delete({
    id: 'comment-1',
    select: ['content', 'post.commentCount', 'post.title'],
  });

  expect(deleteCommentRecord).toHaveBeenCalledWith('comment-1');
  expect(deleteEdge).toHaveBeenCalledWith('Comment', 'comment-1');
  expect(fetchById).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'post-1',
    }),
  );
  expect(deleteCommentRecord.mock.invocationCallOrder[0]).toBeLessThan(
    fetchById.mock.invocationCallOrder[1],
  );
  expect(result).toEqual({
    content: 'hello',
    id: 'comment-1',
    post: {
      commentCount: 2,
      id: 'post-1',
      title: 'Post title',
    },
  });
});
