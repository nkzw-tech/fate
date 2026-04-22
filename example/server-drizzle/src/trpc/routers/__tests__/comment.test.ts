import { beforeEach, expect, test, vi } from 'vite-plus/test';

const { deleteCommentRecord, fetchCommentById, fetchPostById } = vi.hoisted(() => ({
  deleteCommentRecord: vi.fn(),
  fetchCommentById: vi.fn(),
  fetchPostById: vi.fn(),
}));

vi.mock('../../../drizzle/queries.ts', () => ({
  createCommentRecord: vi.fn(),
  deleteCommentRecord,
  fetchCommentById,
  fetchPostById,
  searchCommentsConnection: vi.fn(),
}));
import { router } from '../../init.ts';
import { commentRouter } from '../comment.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

test('delete returns the post relation after the comment has been removed', async () => {
  fetchCommentById.mockResolvedValue({
    authorId: 'user-1',
    content: 'hello',
    id: 'comment-1',
    post: {
      _count: { comments: 3 },
      id: 'post-1',
      title: 'Post title',
    },
    postId: 'post-1',
  });
  fetchPostById.mockResolvedValue({
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
  expect(fetchPostById).toHaveBeenCalledWith('post-1', expect.objectContaining({}));
  expect(deleteCommentRecord.mock.invocationCallOrder[0]).toBeLessThan(
    fetchPostById.mock.invocationCallOrder[0],
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
