import { expect, test } from 'vitest';
import { selectionFromView } from '../selection.ts';
import { ViewsTag } from '../types.ts';
import { view } from '../view.ts';

type User = { __typename: 'User'; email: string; id: string; name: string };

type Post = {
  __typename: 'Post';
  author: User;
  content: string;
  id: string;
  title: string;
};

test('collects scalar and nested selections', () => {
  const PostView = view<Post>()({
    author: {
      email: true,
      id: true,
      name: true,
    },
    content: true,
    id: true,
    title: true,
  });

  const selection = selectionFromView(PostView, null);

  expect(selection).toMatchInlineSnapshot(`
    Set {
      "author.email",
      "author.id",
      "author.name",
      "content",
      "id",
      "title",
    }
  `);
});

test('collects fields from nested views', () => {
  const AuthorView = view<User>()({
    email: true,
    id: true,
  });

  const PostView = view<Post>()({
    author: AuthorView,
    id: true,
  });

  const selection = selectionFromView(PostView, null);

  expect(selection).toMatchInlineSnapshot(`
    Set {
      "author.email",
      "author.id",
      "id",
    }
  `);
});

test('filters nested view selections based on ref tags', () => {
  const AuthorView = view<User>()({
    email: true,
    id: true,
  });

  const PostView = view<Post>()({
    author: AuthorView,
    content: true,
  });

  const [postViewTag] = Object.keys(PostView);
  const [authorViewTag] = Object.keys(AuthorView);

  const refWithoutAuthor = {
    __typename: 'Post',
    id: 'post-1',
    [ViewsTag]: new Set([postViewTag]),
  } as const;

  const refWithAuthor = {
    __typename: 'Post',
    id: 'post-1',
    [ViewsTag]: new Set([postViewTag, authorViewTag]),
  } as const;

  expect(selectionFromView(PostView, refWithoutAuthor)).toMatchInlineSnapshot(`
    Set {
      "content",
    }
  `);
  expect(selectionFromView(PostView, refWithAuthor)).toMatchInlineSnapshot(`
    Set {
      "author.email",
      "author.id",
      "content",
    }
  `);
});
