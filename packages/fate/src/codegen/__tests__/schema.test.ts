import { expect, test } from 'vitest';
import { dataView, list } from '../../server/dataView.ts';
import { createFateSchema } from '../schema.ts';

type User = { id: string; name: string };
type Comment = { author: User; id: string; replies: Array<Comment> };
type Post = { author: User; comments: Array<Comment>; id: string };

test('derives types and entities from data views', () => {
  const userView = dataView<User>('User')({
    id: true,
    name: true,
  });

  const commentView = dataView<Comment>('Comment')({
    author: userView,
    id: true,
    replies: list(
      dataView<Comment>('Comment')({
        author: userView,
        id: true,
        replies: list(dataView<Comment>('Comment')({ id: true })),
      }),
    ),
  });

  const postView = dataView<Post>('Post')({
    author: userView,
    comments: list(commentView),
    id: true,
  });

  const schema = createFateSchema([commentView, postView, userView], {
    posts: postView,
  });

  expect(schema.entities).toEqual({
    comment: { type: 'Comment' },
    post: { list: 'posts', type: 'Post' },
    user: { type: 'User' },
  });

  expect(schema.types).toEqual([
    { type: 'User' },
    {
      fields: {
        author: { type: 'User' },
        replies: { listOf: 'Comment' },
      },
      type: 'Comment',
    },
    {
      fields: {
        author: { type: 'User' },
        comments: { listOf: 'Comment' },
      },
      type: 'Post',
    },
  ]);
});
