import { expect, test } from 'vitest';
import { dataView, list } from '../../server/dataView.ts';
import { createSchema } from '../schema.ts';

type User = { id: string; name: string };
type Comment = { author: User; id: string; replies: Array<Comment> };
type Post = { author: User; comments: Array<Comment>; id: string };
type Event = { id: string; title: string };

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

  const eventView = dataView<Event>('Event')({
    id: true,
    title: true,
  });

  const { entities, types } = createSchema([commentView, postView, userView, eventView], {
    posts: postView,
  });

  expect(entities).toEqual({
    comment: { type: 'Comment' },
    event: { type: 'Event' },
    post: { list: 'posts', type: 'Post' },
    user: { type: 'User' },
  });

  expect(types).toEqual([
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
    { type: 'Event' },
  ]);
});

test('allows defining custom list procedure names', () => {
  const userView = dataView<User>('User')({
    id: true,
    name: true,
  });

  const commentView = dataView<Comment>('Comment')({
    author: userView,
    id: true,
    replies: list(dataView<Comment>('Comment')({ id: true })),
  });

  const { entities } = createSchema([commentView, userView], {
    commentSearch: { procedure: 'search', view: commentView },
  });

  expect(entities.comment).toEqual({
    list: 'commentSearch',
    listProcedure: 'search',
    type: 'Comment',
  });
});
