import { FateRequestError } from '@nkzw/fate/server';
import { expect, test } from 'vite-plus/test';
import { assertCanDeleteComment, getCommentDeleteFetchSelection } from '../commentPermissions.ts';

test('allows comment authors to delete their own comments', () => {
  expect(() => assertCanDeleteComment({ authorId: 'user-1' }, { id: 'user-1' })).not.toThrow();
});

test('rejects anonymous comment deletion with a protocol error', () => {
  expect(() => assertCanDeleteComment({ authorId: 'user-1' }, null)).toThrow(
    new FateRequestError('UNAUTHORIZED', 'You must be logged in.'),
  );
});

test('rejects deleting another users comment with a protocol error', () => {
  expect(() => assertCanDeleteComment({ authorId: 'user-1' }, { id: 'user-2' })).toThrow(
    new FateRequestError('FORBIDDEN', 'You can only delete your own comments.'),
  );
});

test('rejects deleting orphaned comments with a protocol error', () => {
  expect(() => assertCanDeleteComment({ authorId: null }, { id: 'user-1' })).toThrow(
    new FateRequestError('FORBIDDEN', 'You can only delete your own comments.'),
  );
});

test('excludes post selections from the initial delete comment fetch', () => {
  expect(
    getCommentDeleteFetchSelection(['content', 'id', 'post', 'post.commentCount', 'post.title']),
  ).toEqual(['content', 'id']);
});
