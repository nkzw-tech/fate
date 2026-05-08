import { FateRequestError } from '@nkzw/fate/server';

type CommentOwner = Readonly<{ authorId?: string | null }>;
type SessionUser = Readonly<{ id: string }> | null | undefined;

export const assertCanDeleteComment = (comment: CommentOwner, user: SessionUser) => {
  if (!user) {
    throw new FateRequestError('UNAUTHORIZED', 'You must be logged in.');
  }

  if (!comment.authorId || comment.authorId !== user.id) {
    throw new FateRequestError('FORBIDDEN', 'You can only delete your own comments.');
  }
};

export const getCommentDeleteFetchSelection = (select: ReadonlyArray<string>): Array<string> =>
  select.filter((path) => path !== 'post' && !path.startsWith('post.'));
