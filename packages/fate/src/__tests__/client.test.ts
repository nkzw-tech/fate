import { expect, test } from 'vitest';
import { createClient } from '../client.ts';
import { fragment } from '../fragment.ts';
import { toEntityId } from '../ref.ts';
import {
  Fragment,
  FragmentsTag,
  getFragmentTag,
  SelectionOf,
} from '../types.ts';

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

const getId = (record: unknown) => (record as { id: string }).id;

test(`'readFragmentOrThrow' returns the selected fields`, () => {
  const client = createClient({
    entities: [
      {
        fields: { comments: { listOf: 'Comment' } },
        key: getId,
        type: 'Post',
      },
    ],
    transport: {
      async fetchById() {
        return [];
      },
    },
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

  const PostFragment = fragment<Post>()({
    content: true,
    id: true,
  });

  const postRef = client.ref<Post>('Post', 'post-1', PostFragment);

  const result = client.readFragmentOrThrow<
    Post,
    SelectionOf<typeof PostFragment>,
    typeof PostFragment
  >(PostFragment, postRef);

  expect(result).toEqual({
    content: 'Apple Banana',
    id: 'post-1',
  });
});

test(`'readFragmentOrThrow' returns fragment refs when fragments are used`, () => {
  const client = createClient({
    entities: [
      {
        fields: { comments: { listOf: 'Comment' } },
        key: getId,
        type: 'Post',
      },
      { key: getId, type: 'Comment' },
    ],
    transport: {
      async fetchById() {
        return [];
      },
    },
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
      comments: [commentAId, commentBId],
      id: 'post-1',
    },
    '*',
  );

  const CommentFragment = fragment<Comment>()({
    content: true,
    id: true,
  });

  const PostFragment = fragment<Post>()({
    comments: {
      edges: {
        node: CommentFragment,
      },
    },
    id: true,
  });

  const postRef = client.ref<Post>('Post', 'post-1', PostFragment);

  const result = client.readFragmentOrThrow<
    Post,
    SelectionOf<typeof PostFragment>,
    typeof PostFragment
  >(PostFragment, postRef);

  expect(result.id).toBe('post-1');
  expect(result.comments?.edges).toHaveLength(2);

  const [commentA, commentB] = result.comments.edges;
  expect(commentA.node).toEqual({
    __typename: 'Comment',
    id: 'comment-1',
  });
  expect(commentA.node[FragmentsTag]).toEqual(new Set([getFragmentTag(1)]));

  expect(commentB.node).toEqual({
    __typename: 'Comment',
    id: 'comment-2',
  });
  expect(commentB.node[FragmentsTag]).toEqual(new Set([getFragmentTag(1)]));
});

test(`'readFragmentOrThrow' returns fragment refs for list selections`, () => {
  const client = createClient({
    entities: [
      {
        fields: { comments: { listOf: 'Comment' } },
        key: getId,
        type: 'Post',
      },
      { key: getId, type: 'Comment' },
    ],
    transport: {
      async fetchById() {
        return [];
      },
    },
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
      comments: [commentId],
      id: 'post-1',
    },
    '*',
  );

  const CommentFragment = fragment<Comment>()({
    content: true,
    id: true,
  });

  const PostFragment = fragment<Post>()({
    comments: CommentFragment,
    id: true,
  });

  const postRef = client.ref<Post>('Post', 'post-1', PostFragment);

  const result = client.readFragmentOrThrow<
    Post,
    SelectionOf<typeof PostFragment>,
    typeof PostFragment
  >(PostFragment, postRef);

  expect(result.id).toBe('post-1');
  expect(result.comments).toHaveLength(1);

  const comment = result.comments?.[0];
  expect(comment).toEqual({
    __typename: 'Comment',
    id: 'comment-1',
  });

  expect(comment[FragmentsTag]).toEqual(new Set([getFragmentTag(3)]));
});

test(`'readFragmentOrThrow' returns only directly selected fields when fragment spreads are used`, () => {
  const client = createClient({
    entities: [
      {
        fields: { comments: { listOf: 'Comment' } },
        key: getId,
        type: 'Post',
      },
      { key: getId, type: 'Comment' },
    ],
    transport: {
      async fetchById() {
        return [];
      },
    },
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
      comments: [commentId],
      id: 'post-1',
    },
    '*',
  );

  const CommentMetaFragment = fragment<Comment>()({
    id: true,
  });

  const CommentContentFragment = fragment<Comment>()({
    content: true,
  });

  const PostFragment = fragment<Post>()({
    comments: {
      edges: {
        node: {
          ...CommentMetaFragment,
          ...CommentContentFragment,

          content: true,
        },
      },
    },
    id: true,
  });

  const postRef = client.ref<Post>('Post', 'post-1', PostFragment);

  const result = client.readFragmentOrThrow<
    Post,
    SelectionOf<typeof PostFragment>,
    typeof PostFragment
  >(PostFragment, postRef);

  expect(result.id).toBe('post-1');
  expect(result.comments?.edges).toHaveLength(1);
  const comment = result.comments?.edges?.[0]?.node;
  expect(comment).toEqual({
    __typename: 'Comment',
    content: 'Hello world',
    id: 'comment-1',
  });

  expect(comment[FragmentsTag]).toEqual(
    new Set([getFragmentTag(5), getFragmentTag(6)]),
  );
});

test(`'readFragmentOrThrow' resolves object references and their fragments`, () => {
  const client = createClient({
    entities: [
      { key: getId, type: 'Comment' },
      { key: getId, type: 'User' },
    ],
    transport: {
      async fetchById() {
        return [];
      },
    },
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
      author: authorId,
      content: 'Apple',
      id: 'comment-1',
    },
    '*',
  );

  const UserFragment = fragment<User>()({
    name: true,
  });

  const CommentFragment = fragment<Comment>()({
    author: UserFragment,
    content: true,
    id: true,
  });

  const commentRef = client.ref<Comment>(
    'Comment',
    'comment-1',
    CommentFragment,
  );

  const result = client.readFragmentOrThrow<
    Comment,
    SelectionOf<typeof CommentFragment>,
    typeof CommentFragment
  >(CommentFragment, commentRef);

  expect(result.id).toBe('comment-1');
  expect(result.author).toEqual({
    __typename: 'User',
    id: 'user-1',
  });

  expect(result.author[FragmentsTag]).toEqual(new Set([getFragmentTag(8)]));
});

test(`'readFragmentOrThrow' resolves fields only if the ref contains the expected fragments`, () => {
  const client = createClient({
    entities: [
      {
        key: getId,
        type: 'Post',
      },
    ],
    transport: {
      async fetchById() {
        return [];
      },
    },
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

  const PostContentFragment = fragment<Post>()({
    content: true,
  });

  const PostFragment = fragment<Post>()({
    content: true,
    id: true,
  });

  const postRef = client.ref<Post>('Post', 'post-1', PostContentFragment);

  type PostContentSelection = SelectionOf<typeof PostContentFragment>;
  const resultA = client.readFragmentOrThrow<
    Post,
    PostContentSelection,
    typeof PostContentFragment
  >(PostContentFragment, postRef);

  // @ts-expect-error `id` was not selected in the fragment.
  expect(resultA.id).toBeUndefined();
  expect(resultA.content).toBe('Apple Banana');

  // `postRef` contains a ref to `PostContentFragment`, not `PostFragment`.
  const resultB = client.readFragmentOrThrow<
    Post,
    PostContentSelection,
    typeof PostFragment
  >(PostFragment, postRef);

  // @ts-expect-error `id` was not selected in the fragment.
  expect(resultB.id).toBeUndefined();
  expect(resultB.content).toBeUndefined();

  const FullPostFragment = {
    ...PostFragment,
    ...PostContentFragment,
  };

  type FullPostSelection = { content: true; id: true };

  const fullPostRef = client.ref<Post>('Post', 'post-1', FullPostFragment);
  const resultC = client.readFragmentOrThrow<
    Post,
    FullPostSelection,
    Fragment<Post, FullPostSelection>
  >(FullPostFragment as typeof PostFragment, fullPostRef);

  expect(resultC.id).toBe('post-1');
  expect(resultC.content).toBe('Apple Banana');
});
