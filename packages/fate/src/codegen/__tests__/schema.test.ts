import { expect, test } from 'vitest';
import { dataView, list } from '../../server/dataView.ts';
import { createSchema } from '../schema.ts';

type User = { id: string; name: string };
type Comment = { author: User; id: string; replies: Array<Comment> };
type Post = { author: User; comments: Array<Comment>; id: string };
type Event = { id: string; title: string };
type Category = { id: string; name: string };

test('derives types and roots from data views', () => {
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

  const categoryView = dataView<Category>('Category')({
    id: true,
    name: true,
    posts: list(postView),
  });

  const { roots, types } = createSchema(
    [commentView, postView, userView, eventView, categoryView],
    {
      categories: list(categoryView),
      commentSearch: { procedure: 'search', view: list(commentView) },
      events: list(eventView),
      posts: list(postView),
      viewer: userView,
    },
  );

  expect(roots).toEqual({
    categories: { kind: 'list', procedure: 'list', router: 'category', type: 'Category' },
    commentSearch: { kind: 'list', procedure: 'search', router: 'comment', type: 'Comment' },
    events: { kind: 'list', procedure: 'list', router: 'event', type: 'Event' },
    posts: { kind: 'list', procedure: 'list', router: 'post', type: 'Post' },
    viewer: { kind: 'query', procedure: 'viewer', router: 'user', type: 'User' },
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
    { fields: { posts: { listOf: 'Post' } }, type: 'Category' },
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

  const { roots } = createSchema([commentView, userView], {
    commentSearch: { procedure: 'search', view: list(commentView) },
    user: userView,
  });

  expect(roots.commentSearch).toEqual({
    kind: 'list',
    procedure: 'search',
    router: 'comment',
    type: 'Comment',
  });
});

test('derives root type from lists when byId is missing', () => {
  const userProfileView = dataView<User>('UserProfile')({
    id: true,
    name: true,
  });

  const commentView = dataView<Comment>('Comment')({
    author: userProfileView,
    id: true,
  });

  const { roots, types } = createSchema([commentView, userProfileView], {
    userProfile: list(userProfileView),
  });

  expect(types).toEqual([
    { type: 'UserProfile' },
    { fields: { author: { type: 'UserProfile' } }, type: 'Comment' },
  ]);

  expect(roots).toEqual({
    userProfile: { kind: 'list', procedure: 'list', router: 'userProfile', type: 'UserProfile' },
  });
});
