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
      args: { after: 'cursor-1', first: 5 },
      items: { node: CommentView },
    },
    content: { args: { format: 'md' } },
  });

  const plan = selectionFromView(PostView, null);

  expect(plan.paths).toContain('content');
  expect(plan.paths).toContain('comments.id');
  expect(plan.args.get('content')).toEqual({
    hash: 'object:{"format":string:"md"}',
    ignoreKeys: undefined,
    value: { format: 'md' },
  });
  expect(plan.args.get('comments')).toEqual({
    hash: 'object:{"first":number:5}',
    ignoreKeys: new Set(['after', 'before', 'cursor']),
    value: { after: 'cursor-1', first: 5 },
  });
});

type Example = {
  __typename: 'Example';
  args: { value: string };
  id: string;
  pagination: string;
};

test('treats fields named args and pagination as regular selections', () => {
  const ExampleView = view<Example>()({
    args: { value: true },
    id: true,
    pagination: true,
  });

  const selection = selectionFromView(ExampleView, null);

  expect(selection.paths).toContain('args.value');
  expect(selection.paths).toContain('pagination');
});

test('omits connection cursor selections from paths', () => {
  type Comment = { __typename: 'Comment'; id: string };
  type Post = {
    __typename: 'Post';
    comments: Array<Comment>;
  };

  const CommentView = view<Comment>()({
    id: true,
  });

  const PostView = view<Post>()({
    comments: {
      items: { cursor: true, node: CommentView },
    },
  });

  const selection = selectionFromView(PostView, null);

  expect(selection.paths).not.toContain('comments.cursor');
  expect(selection.paths).toContain('comments.id');
});
