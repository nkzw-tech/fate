import { expect, expectTypeOf, test, vi } from 'vitest';
import { createClient } from '../client.ts';
import { mutation } from '../mutation.ts';
import { createNodeRef, getNodeRefId, isNodeRef } from '../node-ref.ts';
import { toEntityId } from '../ref.ts';
import { selectionFromView } from '../selection.ts';
import { getListKey, List } from '../store.ts';
import {
  ConnectionMetadata,
  FateThenable,
  SelectionOf,
  Snapshot,
  View,
  ViewSnapshot,
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

const unwrap = <T extends ViewSnapshot<any, any>>(
  value: FateThenable<T>,
): T['data'] => {
  if (value.status === 'fulfilled') {
    return value.value.data;
  }

  throw new Error(`fate: Cannot unwrap a pending 'FateThenable'.`);
};

const getNodeRefIds = (value: unknown) =>
  Array.isArray(value)
    ? value.map((item) => (isNodeRef(item) ? getNodeRefId(item) : item))
    : [];

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
    new Set(['__typename', 'content', 'id']),
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
    new Set(['__typename', 'author', 'content', 'id']),
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
    new Set(['__typename', 'author', 'content', 'id']),
  );

  const postId = toEntityId('Post', 'post-1');
  client.store.merge(
    postId,
    {
      __typename: 'Post',
      comments: createNodeRefs([commentAId, commentBId]),
      id: 'post-1',
    },
    new Set(['__typename', 'comments', 'id']),
  );

  const CommentView = view<Comment>()({
    content: true,
    id: true,
  });

  const PostView = view<Post>()({
    comments: {
      items: {
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
  expect(result.comments?.items).toHaveLength(2);

  const [commentA, commentB] = result.comments.items;
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
    new Set(['__typename', 'author', 'content', 'id']),
  );

  const postId = toEntityId('Post', 'post-1');
  client.store.merge(
    postId,
    {
      __typename: 'Post',
      comments: createNodeRefs([commentId]),
      id: 'post-1',
    },
    new Set(['__typename', 'comments', 'id']),
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
    new Set(['__typename', 'author', 'content', 'id']),
  );

  const postId = toEntityId('Post', 'post-1');
  client.store.merge(
    postId,
    {
      __typename: 'Post',
      comments: createNodeRefs([commentId]),
      id: 'post-1',
    },
    new Set(['__typename', 'comments', 'id']),
  );

  const CommentMetaView = view<Comment>()({
    id: true,
  });

  const CommentContentView = view<Comment>()({
    content: true,
  });

  const PostView = view<Post>()({
    comments: {
      items: {
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
  expect(result.comments?.items).toHaveLength(1);
  const comment = result.comments?.items?.[0]?.node;
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
  client.store.merge(
    authorId,
    {
      __typename: 'User',
      id: 'user-1',
      name: 'Banana Appleseed',
    },
    new Set(['__typename', 'id', 'name']),
  );

  const commentAId = toEntityId('Comment', 'comment-1');
  client.store.merge(
    commentAId,
    {
      __typename: 'Comment',
      author: createNodeRef(authorId),
      content: 'Apple',
      id: 'comment-1',
    },
    new Set(['__typename', 'author', 'content', 'id']),
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
    new Set(['__typename', 'content', 'id']),
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
    new Set(['__typename', 'author', 'content', 'id']),
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
    new Set(['__typename', 'comments', 'content', 'id']),
  );

  client.store.setList('comments', {
    cursors: ['cursor-1'],
    ids: [commentId],
    pagination: {
      hasNext: true,
      hasPrevious: false,
      nextCursor: 'cursor-2',
    },
  });

  const initialList = client.store.getList('comments');
  if (!initialList) {
    throw new Error('Expected initial list to be defined');
  }

  const initialState = client.store.getListState('comments');
  expect(initialState).toEqual({
    cursors: ['cursor-1'],
    ids: [commentId],
    pagination: {
      hasNext: true,
      hasPrevious: false,
      nextCursor: 'cursor-2',
    },
  });

  const snapshots = new Map<string, Snapshot>();
  const listSnapshots = new Map<string, List>();

  client.deleteRecord('Comment', 'comment-1', snapshots, listSnapshots);

  expect(client.store.read(commentId)).toBeUndefined();

  const updatedPost = client.store.read(postId);
  expect(updatedPost?.comments).toEqual([]);
  expect(client.store.getList('comments')).toEqual([]);

  const storedSnapshot = listSnapshots.get('comments');
  expect(storedSnapshot).toEqual({
    cursors: ['cursor-1'],
    ids: [commentId],
    pagination: {
      hasNext: true,
      hasPrevious: false,
      nextCursor: 'cursor-2',
    },
  });

  for (const [id, snapshot] of snapshots) {
    client.restore(id, snapshot);
  }

  for (const [name, list] of listSnapshots) {
    client.restoreList(name, list);
  }

  const restoredComment = client.store.read(commentId);
  expect(restoredComment).toMatchObject({ id: 'comment-1' });

  const restoredPost = client.store.read(postId);
  expect(getNodeRefIds(restoredPost?.comments)).toEqual([commentId]);
  expect(client.store.getList('comments')).toEqual([commentId]);

  const restoredList = client.store.getList('comments');
  if (!restoredList) {
    throw new Error('Expected restored list to be defined');
  }

  expect(restoredList).toEqual(initialList);

  const restoredState = client.store.getListState('comments');
  expect(restoredState).toEqual(initialState);
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
  client.store.merge(
    authorId,
    {
      __typename: 'User',
      id: 'user-1',
      name: 'Banana Appleseed',
    },
    new Set(['__typename', 'id', 'name']),
  );

  const commentId = toEntityId('Comment', 'comment-1');
  client.store.merge(
    commentId,
    {
      __typename: 'Comment',
      author: createNodeRef(authorId),
      content: 'Apple',
      id: 'comment-1',
    },
    new Set(['__typename', 'author', 'content', 'id']),
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

test('mutations write their responses into the store', async () => {
  type UpdateUserInput = { id: string; name: string };
  type UpdateUserResult = { __typename: 'User'; id: string; name: string };

  const client = createClient({
    mutations: {
      updateUser: mutation<User, UpdateUserInput, UpdateUserResult>('User'),
    },
    transport: {
      async fetchById() {
        return [];
      },
      // @ts-expect-error
      mutate: vi.fn(
        async (
          procedure: string,
          input: UpdateUserInput,
          select: Set<string>,
        ) => {
          expect(procedure).toBe('updateUser');
          expect(input).toEqual({ id: 'user-1', name: 'Banana' });
          expect(new Set(select)).toEqual(new Set(['id', 'name']));
          return {
            __typename: 'User',
            id: 'user-1',
            name: 'Banana',
          } satisfies UpdateUserResult;
        },
      ),
    },
    types: [{ type: 'User' }],
  });

  const UserView = view<User>()({
    id: true,
    name: true,
  });

  const result = await client.mutations.updateUser({
    input: { id: 'user-1', name: 'Banana' },
    view: UserView,
  });

  expect(result).toEqual({ __typename: 'User', id: 'user-1', name: 'Banana' });
  expect(client.store.read(toEntityId('User', 'user-1'))).toMatchObject({
    id: 'user-1',
    name: 'Banana',
  });
});

test('mutations apply optimistic updates before resolving', async () => {
  type UpdateUserInput = { id: string; name: string };
  type UpdateUserResult = { __typename: 'User'; id: string; name: string };

  let resolveMutation: ((value: UpdateUserResult) => void) | undefined;

  const client = createClient({
    mutations: {
      updateUser: mutation<User, UpdateUserInput, UpdateUserResult>('User'),
    },
    transport: {
      async fetchById() {
        return [];
      },
      // @ts-expect-error
      mutate: vi.fn(
        () =>
          new Promise<UpdateUserResult>((resolve) => {
            resolveMutation = resolve;
          }),
      ),
    },
    types: [{ type: 'User' }],
  });

  const UserView = view<User>()({
    id: true,
    name: true,
  });

  const promise = client.mutations.updateUser({
    input: { id: 'user-1', name: 'Server' },
    optimisticUpdate: { name: 'Optimistic' },
    view: UserView,
  });

  expect(client.store.read(toEntityId('User', 'user-1'))).toMatchObject({
    id: 'user-1',
    name: 'Optimistic',
  });

  resolveMutation?.({
    __typename: 'User',
    id: 'user-1',
    name: 'Server',
  });

  await promise;

  expect(client.store.read(toEntityId('User', 'user-1'))).toMatchObject({
    id: 'user-1',
    name: 'Server',
  });
});

test('mutations roll back optimistic updates when requests fail', async () => {
  type UpdateUserInput = { id: string; name: string };
  type UpdateUserResult = { __typename: 'User'; id: string; name: string };

  const mutate = vi.fn(async () => {
    throw new Error('network error');
  });

  const client = createClient({
    mutations: {
      updateUser: mutation<User, UpdateUserInput, UpdateUserResult>('User'),
    },
    transport: {
      async fetchById() {
        return [];
      },
      mutate,
    },
    types: [{ type: 'User' }],
  });

  const initialRecord = {
    __typename: 'User',
    id: 'user-1',
    name: 'Initial',
  } satisfies UpdateUserResult;

  client.store.merge(
    toEntityId('User', 'user-1'),
    initialRecord,
    new Set(['__typename', 'id', 'name']),
  );

  const UserView = view<User>()({
    id: true,
    name: true,
  });

  const promise = client.mutations.updateUser({
    input: { id: 'user-1', name: 'Server' },
    optimisticUpdate: { name: 'Optimistic' },
    view: UserView,
  });

  expect(client.store.read(toEntityId('User', 'user-1'))).toMatchObject({
    id: 'user-1',
    name: 'Optimistic',
  });

  await expect(promise).rejects.toThrow('network error');

  expect(client.store.read(toEntityId('User', 'user-1'))).toMatchObject({
    id: 'user-1',
    name: 'Initial',
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
    undefined,
  );

  const { data, ids } = await thenable;
  expect(data.content).toBe('Kiwi');
  expect(ids).toEqual(new Set([postEntityId, toEntityId('User', 'user-1')]));
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
    undefined,
  );
});

test(`'request' forwards nested selection args to by-id transports`, async () => {
  const fetchById = vi.fn().mockResolvedValue([
    {
      __typename: 'Post',
      comments: [],
      id: 'post-1',
    },
  ]);

  const client = createClient({
    transport: {
      fetchById,
    },
    types: [
      { fields: { comments: { listOf: 'Comment' } }, type: 'Post' },
      { type: 'Comment' },
    ],
  });

  const CommentView = view<Comment>()({ id: true });
  const PostView = view<Post>()({
    comments: {
      args: { first: 1 },
      items: { node: CommentView },
    },
    id: true,
  });

  await client.request({
    post: {
      ids: ['post-1'],
      root: PostView,
      type: 'Post',
    },
  });

  expect(fetchById).toHaveBeenCalledWith(
    'Post',
    ['post-1'],
    new Set(['comments.id', 'id']),
    { comments: { first: 1 } },
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
    undefined,
  );
});

test(`'request' fetches list selections via the transport`, async () => {
  const fetchList = vi.fn().mockResolvedValue({
    items: [
      {
        cursor: 'cursor-1',
        node: { __typename: 'Comment', content: 'First', id: 'comment-1' },
      },
    ],
    pagination: { hasNext: false, hasPrevious: false },
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
    new Set(['content', 'id']),
    { first: 1 },
  );
});

test(`'request' forwards nested selection args to list transports`, async () => {
  const fetchList = vi.fn().mockResolvedValue({
    items: [],
    pagination: { hasNext: false, hasPrevious: false },
  });

  const client = createClient({
    transport: {
      async fetchById() {
        return [];
      },
      fetchList,
    },
    types: [
      { fields: { comments: { listOf: 'Comment' } }, type: 'Post' },
      { type: 'Comment' },
    ],
  });

  const CommentView = view<Comment>()({ id: true });
  const PostView = view<Post>()({
    comments: {
      args: { first: 1 },
      items: { node: CommentView },
    },
    id: true,
  });

  await client.request({
    posts: {
      args: { first: 1 },
      root: PostView,
      type: 'Post',
    },
  });

  expect(fetchList).toHaveBeenCalledWith(
    'posts',
    new Set(['comments.id', 'id']),
    {
      comments: { first: 1 },
      first: 1,
    },
  );
});

test(`'readView' returns list metadata when available`, () => {
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
    new Set(['__typename', 'author', 'content', 'id']),
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
    new Set(['__typename', 'author', 'content', 'id']),
  );

  const postId = toEntityId('Post', 'post-1');
  const commentIds = [commentAId, commentBId];
  client.store.setList(getListKey(postId, 'comments'), {
    cursors: ['cursor-a', 'cursor-b'],
    ids: commentIds,
    pagination: {
      hasNext: true,
      hasPrevious: false,
      nextCursor: 'cursor-b',
    },
  });

  client.store.merge(
    postId,
    {
      __typename: 'Post',
      comments: createNodeRefs(commentIds),
      id: 'post-1',
    },
    new Set(['__typename', 'comments', 'id']),
  );

  const CommentView = view<Comment>()({
    content: true,
    id: true,
  });

  const PostView = view<Post>()({
    comments: {
      items: {
        cursor: true,
        node: CommentView,
      },
      pagination: {
        hasNext: true,
        nextCursor: true,
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

  expect(result.comments?.items).toHaveLength(2);
  expect(result.comments?.items?.map(({ node }) => node?.id)).toEqual([
    'comment-1',
    'comment-2',
  ]);
  expect(result.comments?.items?.[0]?.cursor).toBe('cursor-a');
  expect(result.comments?.items?.[1]?.cursor).toBe('cursor-b');
  expect(result.comments?.pagination).toEqual({
    hasNext: true,
    nextCursor: 'cursor-b',
  });
});

test('normalizeEntity stores connection lists using argument hashes', () => {
  type Comment = { __typename: 'Comment'; id: string };
  type Post = {
    __typename: 'Post';
    comments: Array<Comment>;
    id: string;
  };

  const client = createClient({
    transport: {
      async fetchById() {
        return [];
      },
    },
    types: [
      { fields: { comments: { listOf: 'Comment' } }, type: 'Post' },
      { type: 'Comment' },
    ],
  });

  const CommentView = view<Comment>()({ id: true });
  const PostView = view<Post>()({
    comments: {
      args: { after: 'cursor-10', first: 3 },
      items: { node: CommentView },
    },
  });

  const plan = selectionFromView(PostView, null);

  client.write(
    'Post',
    {
      __typename: 'Post',
      comments: {
        items: [
          { node: { __typename: 'Comment', id: 'comment-1' } },
          { node: { __typename: 'Comment', id: 'comment-2' } },
        ],
      },
      id: 'post-1',
    },
    plan.paths,
    undefined,
    plan,
  );

  const postId = toEntityId('Post', 'post-1');
  expect(
    client.store.getList(
      getListKey(postId, 'comments', plan.args.get('comments')?.hash),
    ),
  ).toEqual([
    toEntityId('Comment', 'comment-1'),
    toEntityId('Comment', 'comment-2'),
  ]);
});

test(`'loadConnection' scopes args to the connection field`, async () => {
  const fetchById = vi.fn(async () => [
    {
      comments: {
        items: [
          {
            cursor: 'cursor-2',
            node: {
              __typename: 'Comment',
              content: 'Second comment',
              id: 'comment-2',
            },
          },
        ],
        pagination: {
          hasNext: false,
          hasPrevious: true,
        },
      },
    },
  ]);

  const client = createClient({
    transport: {
      fetchById,
    },
    types: [
      { fields: { comments: { listOf: 'Comment' } }, type: 'Post' },
      { type: 'Comment' },
    ],
  });

  const CommentView = view<Comment>()({
    content: true,
    id: true,
  });

  const postId = toEntityId('Post', 'post-1');
  client.store.merge(
    postId,
    {
      __typename: 'Post',
      comments: [],
      id: 'post-1',
    },
    new Set(['__typename', 'comments', 'id']),
  );

  const metadata: ConnectionMetadata = {
    args: { first: 2 },
    field: 'comments',
    hash: 'hash',
    key: getListKey(postId, 'comments', 'hash'),
    owner: postId,
    procedure: 'Post.comments',
  };

  await client.loadConnection(CommentView, metadata, { after: 'cursor-1' });

  expect(fetchById).toHaveBeenCalledTimes(1);
  expect(fetchById).toHaveBeenCalledWith(
    'Post',
    ['post-1'],
    new Set(['comments.content', 'comments.id']),
    { comments: { after: 'cursor-1', first: 2, id: 'post-1' } },
  );
});

test(`mutation results with arrays mark nested fields as fetched`, async () => {
  type CommentResult = { __typename: 'Comment'; content: string; id: string };
  type UpdatePostInput = { id: string };
  type UpdatePostResult = {
    __typename: 'Post';
    comments: Array<CommentResult>;
    id: string;
  };

  const mutate = vi.fn().mockResolvedValue({
    __typename: 'Post',
    comments: [
      {
        __typename: 'Comment',
        content: 'Hello from mutation',
        id: 'comment-1',
      },
    ],
    id: 'post-1',
  } satisfies UpdatePostResult);

  const client = createClient({
    mutations: {
      updatePost: mutation<Post, UpdatePostInput, UpdatePostResult>('Post'),
    },
    transport: {
      async fetchById() {
        return [];
      },
      mutate,
    },
    types: [
      { fields: { comments: { listOf: 'Comment' } }, type: 'Post' },
      { type: 'Comment' },
    ],
  });

  await client.mutations.updatePost({
    input: { id: 'post-1' },
  });

  const commentEntityId = toEntityId('Comment', 'comment-1');
  expect(client.store.read(commentEntityId)).toMatchObject({
    __typename: 'Comment',
    content: 'Hello from mutation',
    id: 'comment-1',
  });

  const missing = client.store.missingForSelection(commentEntityId, [
    'content',
    'id',
  ]);

  expect(missing).toEqual(new Set());
});

test(`mutation results with connections reuse view args and hydrate nodes`, async () => {
  type UpdatePostInput = { id: string };
  type UpdatePostResult = {
    __typename: 'Post';
    comments: {
      items: Array<{
        cursor: string;
        node: Comment;
      }>;
      pagination: {
        hasNext: boolean;
        hasPrevious: boolean;
        nextCursor?: string;
        previousCursor?: string;
      };
    };
    id: string;
  };

  const fetchById = vi.fn(async () => []);
  const mutate = vi.fn(
    async (key: 'updatePost', input: unknown, select: Set<string>) => {
      expect(key).toBe('updatePost');
      expect(select).toBeInstanceOf(Set);
      expect(input).toEqual({
        args: { comments: { first: 1 } },
        id: 'post-1',
      });

      return {
        __typename: 'Post',
        comments: {
          items: [
            {
              cursor: 'comment-1',
              node: {
                __typename: 'Comment',
                author: {
                  __typename: 'User',
                  id: 'user-1',
                  name: 'Alice',
                },
                content: 'Hello from mutation',
                id: 'comment-1',
              },
            },
          ],
          pagination: {
            hasNext: false,
            hasPrevious: false,
            nextCursor: undefined,
            previousCursor: undefined,
          },
        },
        id: 'post-1',
      } satisfies UpdatePostResult;
    },
  );

  const client = createClient({
    mutations: {
      updatePost: mutation<Post, UpdatePostInput, UpdatePostResult>('Post'),
    },
    transport: {
      fetchById,
      mutate: mutate as any,
    },
    types: [
      { fields: { comments: { listOf: 'Comment' } }, type: 'Post' },
      { fields: { author: { type: 'User' } }, type: 'Comment' },
      { type: 'User' },
    ],
  });

  const CommentView = view<Comment>()({
    author: {
      id: true,
      name: true,
    },
    content: true,
    id: true,
  });
  const PostView = view<Post>()({
    comments: {
      args: { first: 1 },
      items: { node: CommentView },
    },
    id: true,
  });

  await client.mutations.updatePost({
    input: { id: 'post-1' },
    view: PostView,
  });

  expect(mutate).toHaveBeenCalledWith(
    'updatePost',
    {
      args: { comments: { first: 1 } },
      id: 'post-1',
    },
    expect.any(Set),
  );
  expect(fetchById).not.toHaveBeenCalled();

  const commentEntityId = toEntityId('Comment', 'comment-1');
  expect(
    client.store.missingForSelection(commentEntityId, [
      'author',
      'author.id',
      'author.name',
      'content',
      'id',
    ]),
  ).toEqual(new Set());

  const commentRef = client.ref<Comment>('Comment', 'comment-1', CommentView);
  const comment = unwrap(
    client.readView<
      Comment,
      SelectionOf<typeof CommentView>,
      typeof CommentView
    >(CommentView, commentRef),
  );

  expect(comment.id).toBe('comment-1');
  expect(comment.content).toBe('Hello from mutation');
  expect(comment.author).toEqual({
    __typename: 'User',
    id: 'user-1',
    name: 'Alice',
  });

  const postPlan = selectionFromView(PostView, null);
  const listKey = getListKey(
    toEntityId('Post', 'post-1'),
    'comments',
    postPlan.args.get('comments')?.hash,
  );
  expect(client.store.getList(listKey)).toEqual([
    toEntityId('Comment', 'comment-1'),
  ]);
});

test('mutations do not reset previously loaded connection entries', async () => {
  type UpdatePostInput = { id: string };
  type UpdatePostResult = {
    __typename: 'Post';
    comments: {
      items: Array<{ cursor: string; node: Comment }>;
      pagination: { hasNext: boolean; nextCursor?: string };
    };
    id: string;
  };

  const mutate = vi
    .fn<
      (
        key: 'updatePost',
        input: unknown,
        select: Set<string>,
      ) => Promise<UpdatePostResult>
    >()
    .mockResolvedValue({
      __typename: 'Post',
      comments: {
        items: [
          {
            cursor: 'cursor-1',
            node: {
              __typename: 'Comment',
              author: null,
              content: 'Updated comment',
              id: 'comment-1',
            },
          },
        ],
        pagination: { hasNext: true, nextCursor: 'cursor-1' },
      },
      id: 'post-1',
    });

  const client = createClient({
    mutations: {
      updatePost: mutation<Post, UpdatePostInput, UpdatePostResult>('Post'),
    },
    transport: {
      async fetchById() {
        return [];
      },
      mutate: mutate as any,
    },
    types: [
      { fields: { comments: { listOf: 'Comment' } }, type: 'Post' },
      { type: 'Comment' },
    ],
  });

  const CommentView = view<Comment>()({ content: true, id: true });
  const PostView = view<Post>()({
    comments: {
      args: { first: 1 },
      items: { cursor: true, node: CommentView },
      pagination: { hasNext: true, nextCursor: true },
    },
    id: true,
  });

  const plan = selectionFromView(PostView, null);
  const postId = toEntityId('Post', 'post-1');
  const commentAId = toEntityId('Comment', 'comment-1');
  const commentBId = toEntityId('Comment', 'comment-2');
  const listKey = getListKey(
    postId,
    'comments',
    plan.args.get('comments')?.hash,
  );

  client.store.merge(
    commentAId,
    {
      __typename: 'Comment',
      author: null,
      content: 'Original comment',
      id: 'comment-1',
    },
    new Set(['__typename', 'author', 'content', 'id']),
  );
  client.store.merge(
    commentBId,
    {
      __typename: 'Comment',
      author: null,
      content: 'Second comment',
      id: 'comment-2',
    },
    new Set(['__typename', 'author', 'content', 'id']),
  );
  client.store.merge(
    postId,
    {
      __typename: 'Post',
      comments: createNodeRefs([commentAId, commentBId]),
      id: 'post-1',
    },
    new Set(['__typename', 'comments', 'id']),
  );
  client.store.setList(listKey, {
    ids: [commentAId, commentBId],
    pagination: { hasNext: true, hasPrevious: false, nextCursor: 'cursor-2' },
  });

  await client.mutations.updatePost({
    input: { id: 'post-1' },
    view: PostView,
  });

  expect(client.store.getList(listKey)).toEqual([commentAId, commentBId]);
  const postRecord = client.store.read(postId);
  expect(getNodeRefIds(postRecord?.comments)).toEqual([commentAId, commentBId]);
  expect(client.store.read(commentAId)).toMatchObject({
    content: 'Updated comment',
    id: 'comment-1',
  });
});

test(`'write' registers list state for entity lists`, () => {
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

  client.write(
    'Post',
    {
      __typename: 'Post',
      comments: [
        { __typename: 'Comment', content: 'First', id: 'comment-1' },
        { __typename: 'Comment', content: 'Second', id: 'comment-2' },
      ],
      content: 'Example',
      id: 'post-1',
    },
    new Set([
      '__typename',
      'comments',
      'comments.__typename',
      'comments.content',
      'comments.id',
      'content',
      'id',
    ]),
  );

  const postId = toEntityId('Post', 'post-1');
  const commentIds = [
    toEntityId('Comment', 'comment-1'),
    toEntityId('Comment', 'comment-2'),
  ];

  expect(client.store.getList(getListKey(postId, 'comments'))).toEqual(
    commentIds,
  );
});

test(`'linkParentLists' maintains list registrations for parent entities`, () => {
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
      {
        fields: { post: { type: 'Post' } },
        type: 'Comment',
      },
    ],
  });

  const postId = toEntityId('Post', 'post-1');
  client.store.merge(
    postId,
    {
      __typename: 'Post',
      comments: [],
      content: 'Example',
      id: 'post-1',
    },
    new Set(['__typename', 'comments', 'content', 'id']),
  );

  client.write(
    'Comment',
    {
      __typename: 'Comment',
      content: 'Hello',
      id: 'comment-1',
      post: { __typename: 'Post', id: 'post-1' },
    },
    new Set([
      '__typename',
      'content',
      'id',
      'post',
      'post.__typename',
      'post.id',
    ]),
  );

  const commentId = toEntityId('Comment', 'comment-1');
  expect(client.store.getList(getListKey(postId, 'comments'))).toEqual([
    commentId,
  ]);
});

test(`'linkParentLists' preserves pagination metadata across scoped lists`, () => {
  const client = createClient({
    transport: {
      async fetchById() {
        return [];
      },
    },
    types: [
      { fields: { comments: { listOf: 'Comment' } }, type: 'Post' },
      { fields: { post: { type: 'Post' } }, type: 'Comment' },
    ],
  });

  const postId = toEntityId('Post', 'post-1');
  const existingCommentId = toEntityId('Comment', 'comment-1');
  client.store.merge(
    postId,
    {
      __typename: 'Post',
      comments: createNodeRefs([existingCommentId]),
      content: 'Example',
      id: 'post-1',
    },
    new Set(['__typename', 'comments', 'content', 'id']),
  );

  const pagination = {
    hasNext: true,
    hasPrevious: false,
    nextCursor: 'next-cursor',
    previousCursor: 'prev-cursor',
  } as const;
  const defaultListKey = getListKey(postId, 'comments');
  const scopedListKey = getListKey(postId, 'comments', 'filtered');
  client.store.setList(defaultListKey, {
    cursors: ['cursor-1'],
    ids: [existingCommentId],
    pagination,
  });
  client.store.setList(scopedListKey, {
    cursors: ['cursor-1'],
    ids: [existingCommentId],
    pagination,
  });

  client.write(
    'Comment',
    {
      __typename: 'Comment',
      content: 'Hello',
      id: 'comment-2',
      post: { __typename: 'Post', id: 'post-1' },
    },
    new Set([
      '__typename',
      'content',
      'id',
      'post',
      'post.__typename',
      'post.id',
    ]),
  );

  const newCommentId = toEntityId('Comment', 'comment-2');
  expect(client.store.getListState(defaultListKey)).toEqual({
    cursors: ['cursor-1', undefined],
    ids: [existingCommentId, newCommentId],
    pagination,
  });
  expect(client.store.getListState(scopedListKey)).toEqual({
    cursors: ['cursor-1', undefined],
    ids: [existingCommentId, newCommentId],
    pagination,
  });
});
