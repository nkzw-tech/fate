import { beforeEach, expect, test, vi } from 'vite-plus/test';

const { deleteCommentRecord, drizzleRegistry, fetchById } = vi.hoisted(() => ({
  deleteCommentRecord: vi.fn(),
  drizzleRegistry: new Map(),
  fetchById: vi.fn(),
}));

vi.mock('../../../drizzle/queries.ts', () => ({
  createCommentRecord: vi.fn(),
  deleteCommentRecord,
}));

vi.mock('../../executor.ts', () => ({
  drizzleRegistry,
  drizzleRuntime: {
    fetchById,
  },
}));
import { router } from '../../init.ts';
import { postSource } from '../../views.ts';
import { commentRouter } from '../comment.ts';

beforeEach(() => {
  vi.clearAllMocks();
  drizzleRegistry.clear();
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

  drizzleRegistry.set(postSource, {
    byId: ({ id, plan }: { id: string; plan: { resolve: (item: unknown) => Promise<unknown> } }) =>
      fetchById({
        id,
        plan,
      }),
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
