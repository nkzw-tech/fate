import { expect, test } from 'vitest';
import { args, v } from '../args.ts';
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

  expect(selection.paths).toMatchInlineSnapshot(`
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

  expect(selectionFromView(PostView, null).paths).toMatchInlineSnapshot(`
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

  expect(selectionFromView(PostView, refWithoutAuthor).paths)
    .toMatchInlineSnapshot(`
    Set {
      "content",
    }
  `);
  expect(selectionFromView(PostView, refWithAuthor).paths)
    .toMatchInlineSnapshot(`
    Set {
      "author.email",
      "author.id",
      "content",
    }
  `);
});

test('selection plan resolves arguments and hashes connection args', () => {
  type Comment = { __typename: 'Comment'; id: string };
  type Post = {
    __typename: 'Post';
    comments: Array<Comment>;
    content: string;
    id: string;
  };

  const CommentView = view<Comment>()({
    id: true,
  });

  const PostView = view<Post>()({
    comments: {
      args: args({ after: v('commentsAfter'), first: v('commentsFirst', 1) }),
      items: { node: CommentView },
    },
    content: args({ format: v('format', 'md') }),
  });

  const plan = selectionFromView(PostView, null, {
    commentsAfter: 'cursor-1',
    commentsFirst: 5,
    format: 'html',
  });

  expect(plan.paths).toContain('content');
  expect(plan.paths).toContain('comments.id');
  expect(plan.args.get('content')).toEqual({
    hash: 'object:{"format":string:"html"}',
    value: { format: 'html' },
  });
  expect(plan.args.get('comments')).toEqual({
    hash: 'object:{"first":number:5}',
    value: { after: 'cursor-1', first: 5 },
  });
});
