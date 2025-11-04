import { expect, expectTypeOf, test, vi } from 'vitest';
import { createClient } from '../client.ts';
import { mutation } from '../mutation.ts';
import { createNodeRef, getNodeRefId, isNodeRef } from '../node-ref.ts';
import { toEntityId } from '../ref.ts';
import {
  FateThenable,
  SelectionOf,
  Snapshot,
  View,
  ViewsTag,
} from '../types.ts';
import { getViewNames, view } from '../view.ts';

type User = { __typename: 'User'; id: string; name: string };

type Comment = {
  __typename: 'Comment';
  author: User | null;
  content: string;
  id: string;
};

type Post = {
  __typename: 'Post';
  comments: Array<Comment>;
  content: string;
  id: string;
};

const tagsFor = (...views: Array<View<any, any>>) =>
  new Set(views.flatMap((view) => Array.from(getViewNames(view))));

const unwrap = <T>(value: FateThenable<T>): T => {
  if (value.status === 'fulfilled') {
    return value.value;
  }

  throw new Error(`fate: Cannot unwrap a pending 'FateThenable'.`);
};

const nodeRefsToIds = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => (isNodeRef(item) ? getNodeRefId(item) : item));
};

const createNodeRefs = (ids: Array<string>) =>
  ids.map((id) => createNodeRef(id));

test(`'readView' returns the selected fields`, () => {
  const client = createClient({
    transport: {
      async fetchById() {
        return [];
      },
    },
    types: [
      {
        fields: { comments: { listOf: 'Comment' } },
        type: 'Post',
      },
      { type: 'Comment' },
    ],
  });

  const postId = toEntityId('Post', 'post-1');
  client.store.merge(
    postId,
    {
      __typename: 'Post',
      content: 'Apple Banana',
      id: 'post-1',
    },
    '*',
  );

  const PostView = view<Post>()({
    content: true,
    id: true,
  });

  const postRef = client.ref<Post>('Post', 'post-1', PostView);

  const result = unwrap(
    client.readView<Post, SelectionOf<typeof PostView>, typeof PostView>(
      PostView,
      postRef,
    ),
  );

  expectTypeOf(result).toEqualTypeOf<
    Readonly<{
      content: string;
      id: string;
      [ViewsTag]: Set<string>;
    }>
  >();

  expect(result).toEqual({
    content: 'Apple Banana',
    id: 'post-1',
  });
});

test(`'readView' returns view refs when views are used`, () => {
  const client = createClient({
    transport: {
      async fetchById() {
        return [];
      },
    },
    types: [
      {
        fields: { comments: { listOf: 'Comment' } },
        type: 'Post',
      },
      { type: 'Comment' },
    ],
  });

  const commentAId = toEntityId('Comment', 'comment-1');
  client.store.merge(
    commentAId,
    {
      __typename: 'Comment',
      author: null,
      content: 'Apple',
      id: 'comment-1',
    },
    '*',
  );

  const commentBId = toEntityId('Comment', 'comment-2');
  client.store.merge(
    commentBId,
    {
      __typename: 'Comment',
      author: null,
      content: 'Banana',
      id: 'comment-2',
    },
    '*',
  );

  const postId = toEntityId('Post', 'post-1');
  client.store.merge(
    postId,
    {
      __typename: 'Post',
      comments: createNodeRefs([commentAId, commentBId]),
      id: 'post-1',
    },
    '*',
  );

  const CommentView = view<Comment>()({
    content: true,
    id: true,
  });

  const PostView = view<Post>()({
    comments: {
      edges: {
        node: CommentView,
      },
    },
    id: true,
  });

  const postRef = client.ref<Post>('Post', 'post-1', PostView);

  const result = unwrap(
    client.readView<Post, SelectionOf<typeof PostView>, typeof PostView>(
      PostView,
      postRef,
    ),
  );

  expect(result.id).toBe('post-1');
  expect(result.comments?.edges).toHaveLength(2);

  const [commentA, commentB] = result.comments.edges;
  expect(commentA.node).toEqual({
    __typename: 'Comment',
    id: 'comment-1',
  });
  expect(commentA.node[ViewsTag]).toEqual(tagsFor(CommentView));

  expect(commentB.node).toEqual({
    __typename: 'Comment',
    id: 'comment-2',
  });
  expect(commentB.node[ViewsTag]).toEqual(tagsFor(CommentView));
});

test(`'readView' returns view refs for list selections`, () => {
  const client = createClient({
    transport: {
      async fetchById() {
        return [];
      },
    },
    types: [
      {
        fields: { comments: { listOf: 'Comment' } },
        type: 'Post',
      },
      { type: 'Comment' },
    ],
  });

  const commentId = toEntityId('Comment', 'comment-1');
  client.store.merge(
    commentId,
    {
      __typename: 'Comment',
      author: null,
      content: 'Hello world',
      id: 'comment-1',
    },
    '*',
  );

  const postId = toEntityId('Post', 'post-1');
  client.store.merge(
    postId,
    {
      __typename: 'Post',
      comments: createNodeRefs([commentId]),
      id: 'post-1',
    },
    '*',
  );

  const CommentView = view<Comment>()({
    content: true,
    id: true,
  });

  const PostView = view<Post>()({
    comments: CommentView,
    id: true,
  });

  const postRef = client.ref<Post>('Post', 'post-1', PostView);

  const result = unwrap(
    client.readView<Post, SelectionOf<typeof PostView>, typeof PostView>(
      PostView,
      postRef,
    ),
  );

  expect(result.id).toBe('post-1');
  expect(result.comments).toHaveLength(1);

  const comment = result.comments?.[0];
  expect(comment).toEqual({
    __typename: 'Comment',
    id: 'comment-1',
  });

  expect(comment[ViewsTag]).toEqual(tagsFor(CommentView));
});

test(`'readView' returns only directly selected fields when view spreads are used`, () => {
  const client = createClient({
    transport: {
      async fetchById() {
        return [];
      },
    },
    types: [
      {
        fields: { comments: { listOf: 'Comment' } },
        type: 'Post',
      },
      { type: 'Comment' },
    ],
  });

  const commentId = toEntityId('Comment', 'comment-1');
  client.store.merge(
    commentId,
    {
      __typename: 'Comment',
      author: null,
      content: 'Hello world',
      id: 'comment-1',
    },
    '*',
  );

  const postId = toEntityId('Post', 'post-1');
  client.store.merge(
    postId,
    {
      __typename: 'Post',
      comments: createNodeRefs([commentId]),
      id: 'post-1',
    },
    '*',
  );

  const CommentMetaView = view<Comment>()({
    id: true,
  });

  const CommentContentView = view<Comment>()({
    content: true,
  });

  const PostView = view<Post>()({
    comments: {
      edges: {
        node: {
          ...CommentMetaView,
          ...CommentContentView,

          content: true,
        },
      },
    },
    id: true,
  });

  const postRef = client.ref<Post>('Post', 'post-1', PostView);

  const result = unwrap(
    client.readView<Post, SelectionOf<typeof PostView>, typeof PostView>(
      PostView,
      postRef,
    ),
  );

  expect(result.id).toBe('post-1');
  expect(result.comments?.edges).toHaveLength(1);
  const comment = result.comments?.edges?.[0]?.node;
  expect(comment).toEqual({
    __typename: 'Comment',
    content: 'Hello world',
    id: 'comment-1',
  });

  expect(comment[ViewsTag]).toEqual(
    tagsFor(CommentMetaView, CommentContentView),
  );
});

test(`'readView' resolves object references and their views`, () => {
  const client = createClient({
    transport: {
      async fetchById() {
        return [];
      },
    },
    types: [{ type: 'Comment' }, { type: 'User' }],
  });

  const authorId = toEntityId('User', 'user-1');
  client.store.merge(authorId, {
    __typename: 'User',
    id: 'user-1',
    name: 'Banana Appleseed',
  });

  const commentAId = toEntityId('Comment', 'comment-1');
  client.store.merge(
    commentAId,
    {
      __typename: 'Comment',
      author: createNodeRef(authorId),
      content: 'Apple',
      id: 'comment-1',
    },
    '*',
  );

  const UserView = view<User>()({
    name: true,
  });

  const CommentView = view<Comment>()({
    author: UserView,
    content: true,
    id: true,
  });

  const commentRef = client.ref<Comment>('Comment', 'comment-1', CommentView);

  const result = unwrap(
    client.readView<
      Comment,
      SelectionOf<typeof CommentView>,
      typeof CommentView
    >(CommentView, commentRef),
  );

  expect(result.id).toBe('comment-1');
  expect(result.author).toEqual({
    __typename: 'User',
    id: 'user-1',
  });

  expect(result.author[ViewsTag]).toEqual(tagsFor(UserView));
});

test(`'readView' resolves fields only if the ref contains the expected views`, () => {
  const client = createClient({
    transport: {
      async fetchById() {
        return [];
      },
    },
    types: [
      {
        type: 'Post',
      },
    ],
  });

  const postId = toEntityId('Post', 'post-1');
  client.store.merge(
    postId,
    {
      __typename: 'Post',
      content: 'Apple Banana',
      id: 'post-1',
    },
    '*',
  );

  const PostContentView = view<Post>()({
    content: true,
  });

  const PostView = view<Post>()({
    content: true,
    id: true,
  });

  const postRef = client.ref<Post>('Post', 'post-1', PostContentView);

  type PostContentSelection = SelectionOf<typeof PostContentView>;
  const resultA = unwrap(
    client.readView<Post, PostContentSelection, typeof PostContentView>(
      PostContentView,
      postRef,
    ),
  );

  // @ts-expect-error `id` was not selected in the view.
  expect(resultA.id).toBeUndefined();
  expect(resultA.content).toBe('Apple Banana');

  // `postRef` contains a ref to `PostContentView`, not `PostView`.
  const resultB = unwrap(
    client.readView<Post, PostContentSelection, typeof PostView>(
      PostView,
      postRef,
    ),
  );

  // @ts-expect-error `id` was not selected in the view.
  expect(resultB.id).toBeUndefined();
  expect(resultB.content).toBeUndefined();

  const FullPostView = {
    ...PostView,
    ...PostContentView,
  };

  type FullPostSelection = { content: true; id: true };

  const fullPostRef = client.ref<Post>('Post', 'post-1', FullPostView);
  const resultC = unwrap(
    client.readView<Post, FullPostSelection, View<Post, FullPostSelection>>(
      FullPostView as typeof PostView,
      fullPostRef,
    ),
  );

  expect(resultC.id).toBe('post-1');
  expect(resultC.content).toBe('Apple Banana');
});

test(`'deleteRecord' removes an entity and cleans references`, () => {
  const client = createClient({
    transport: {
      async fetchById() {
        return [];
      },
    },
    types: [
      {
        fields: { comments: { listOf: 'Comment' } },
        type: 'Post',
      },
      { type: 'Comment' },
    ],
  });

  const commentId = toEntityId('Comment', 'comment-1');
  client.store.merge(
    commentId,
    {
      __typename: 'Comment',
      author: null,
      content: 'Hello world',
      id: 'comment-1',
    },
    '*',
  );

  const postId = toEntityId('Post', 'post-1');
  client.store.merge(
    postId,
    {
      __typename: 'Post',
      comments: createNodeRefs([commentId]),
      content: 'Post content',
      id: 'post-1',
    },
    '*',
  );

  client.store.setList('comments', [commentId]);

  const snapshots = new Map<string, Snapshot>();
  const listSnapshots = new Map<string, Array<string>>();

  client.deleteRecord('Comment', 'comment-1', snapshots, listSnapshots);

  expect(client.store.read(commentId)).toBeUndefined();

  const updatedPost = client.store.read(postId);
  expect(updatedPost?.comments).toEqual([]);
  expect(client.store.getList('comments')).toEqual([]);

  for (const [id, snapshot] of snapshots) {
    client.restore(id, snapshot);
  }

  for (const [name, ids] of listSnapshots) {
    client.restoreList(name, ids);
  }

  const restoredComment = client.store.read(commentId);
  expect(restoredComment).toMatchObject({ id: 'comment-1' });

  const restoredPost = client.store.read(postId);
  expect(nodeRefsToIds(restoredPost?.comments)).toEqual([commentId]);
  expect(client.store.getList('comments')).toEqual([commentId]);
});

test(`'readView' resolves nested selections without view spreads`, () => {
  const client = createClient({
    transport: {
      async fetchById() {
        return [];
      },
    },
    types: [{ type: 'Comment' }, { type: 'User' }],
  });

  const authorId = toEntityId('User', 'user-1');
  client.store.merge(authorId, {
    __typename: 'User',
    id: 'user-1',
    name: 'Banana Appleseed',
  });

  const commentId = toEntityId('Comment', 'comment-1');
  client.store.merge(
    commentId,
    {
      __typename: 'Comment',
      author: createNodeRef(authorId),
      content: 'Apple',
      id: 'comment-1',
    },
    '*',
  );

  const CommentView = view<Comment>()({
    author: {
      id: true,
      name: true,
    },
    content: true,
    id: true,
  });

  const commentRef = client.ref<Comment>('Comment', 'comment-1', CommentView);

  const result = unwrap(
    client.readView<
      Comment,
      SelectionOf<typeof CommentView>,
      typeof CommentView
    >(CommentView, commentRef),
  );

  expect(result.id).toBe('comment-1');
  expect(result.content).toBe('Apple');
  expect(result.author).toEqual({
    __typename: 'User',
    id: 'user-1',
    name: 'Banana Appleseed',
  });
});

test(`optimistic updates without identifiers are ignored`, async () => {
  type CreatePostInput = { content: string };
  type CreatePostResult = { content: string; id: string };

  const mutate = vi
    .fn()
    .mockResolvedValue({ content: 'Published', id: 'post-1' });

  const client = createClient({
    mutations: {
      createPost: mutation<Post, CreatePostInput, CreatePostResult>('Post'),
    },
    transport: {
      async fetchById() {
        return [];
      },
      mutate,
    },
    types: [{ type: 'Post' }],
  });

  const writeSpy = vi.spyOn(client as any, 'write');

  const result = await client.mutations.createPost({
    input: { content: 'Draft' },
    optimisticUpdate: { content: 'Draft' },
  });

  expect(result).toEqual({ content: 'Published', id: 'post-1' });
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(writeSpy).toHaveBeenCalledTimes(1);
  expect(writeSpy.mock.calls[0][1]).toEqual({
    content: 'Published',
    id: 'post-1',
  });
  expect(client.store.read(toEntityId('Post', 'post-1'))).toMatchObject({
    content: 'Published',
    id: 'post-1',
  });
});

test(`'readView' fetches missing fields using the selection`, async () => {
  type User = { __typename: 'User'; id: string; name: string };
  type Post = {
    __typename: 'Post';
    author: User;
    content: string;
    id: string;
  };

  const fetchById = vi.fn(async () => [
    {
      __typename: 'Post',
      author: { __typename: 'User', id: 'user-1', name: 'Alice' },
      content: 'Kiwi',
      id: 'post-1',
    },
  ]);

  const client = createClient({
    transport: {
      fetchById,
    },
    types: [
      { fields: { author: { type: 'User' } }, type: 'Post' },
      { type: 'User' },
    ],
  });

  const postEntityId = toEntityId('Post', 'post-1');
  client.store.merge(postEntityId, { __typename: 'Post', id: 'post-1' }, [
    'id',
  ]);

  const PostView = view<Post>()({
    author: {
      id: true,
      name: true,
    },
    content: true,
    id: true,
  });

  const postRef = client.ref<Post>('Post', 'post-1', PostView);

  const thenable = client.readView<
    Post,
    SelectionOf<typeof PostView>,
    typeof PostView
  >(PostView, postRef);

  expect(fetchById).toHaveBeenCalledTimes(1);

  expect(fetchById).toHaveBeenCalledWith(
    'Post',
    ['post-1'],
    new Set(['author.id', 'author.name', 'content']),
  );

  const post = await thenable;
  expect(post.content).toBe('Kiwi');
});

test(`'request' groups ids by selection before fetching`, async () => {
  type Post = { __typename: 'Post'; content: string; id: string };

  const fetchById = vi.fn(async () => [
    {
      __typename: 'Post',
      content: 'Hello',
      id: 'post-1',
    },
  ]);

  const client = createClient({
    transport: {
      fetchById,
    },
    types: [{ type: 'Post' }],
  });

  const postEntityId = toEntityId('Post', 'post-1');
  client.store.merge(postEntityId, { __typename: 'Post', id: 'post-1' }, [
    'id',
  ]);

  const PostView = view<Post>()({
    content: true,
    id: true,
  });

  await client.request({
    post: {
      ids: ['post-1'],
      root: PostView,
      type: 'Post',
    },
  });

  expect(fetchById).toHaveBeenCalledTimes(1);
  expect(fetchById).toHaveBeenCalledWith(
    'Post',
    ['post-1'],
    new Set(['content', 'id']),
  );
});

test(`'request' fetches view selections via the transport`, async () => {
  const fetchById = vi
    .fn()
    .mockResolvedValue([
      { __typename: 'Post', content: 'Apple Banana', id: 'post-1' },
    ]);

  const client = createClient({
    transport: {
      fetchById,
    },
    types: [{ type: 'Post' }],
  });

  const postId = toEntityId('Post', 'post-1');
  client.store.merge(
    postId,
    {
      __typename: 'Post',
      id: 'post-1',
    },
    ['id'],
  );

  const PostView = view<Post>()({
    content: true,
    id: true,
  });

  await client.request({
    post: {
      ids: ['post-1'],
      root: PostView,
      type: 'Post',
    },
  });

  expect(fetchById).toHaveBeenCalledTimes(1);
  expect(fetchById).toHaveBeenCalledWith(
    'Post',
    ['post-1'],
    new Set(['content', 'id']),
  );
});

test(`'request' fetches list selections via the transport`, async () => {
  const fetchList = vi.fn().mockResolvedValue({
    edges: [
      {
        cursor: 'cursor-1',
        node: { __typename: 'Comment', content: 'First', id: 'comment-1' },
      },
    ],
    pageInfo: { hasNextPage: false },
  });

  const client = createClient({
    transport: {
      async fetchById() {
        return [];
      },
      fetchList,
    },
    types: [{ type: 'Comment' }],
  });

  const CommentView = view<Comment>()({
    content: true,
    id: true,
  });

  await client.request({
    comments: {
      args: { first: 1 },
      root: CommentView,
      type: 'Comment',
    },
  });

  expect(fetchList).toHaveBeenCalledTimes(1);
  expect(fetchList).toHaveBeenCalledWith(
    'comments',
    { first: 1 },
    new Set(['content', 'id']),
  );
});
