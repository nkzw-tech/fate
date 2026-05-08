/**
 * @vitest-environment happy-dom
 */

import { ConnectionTag, createClient, toEntityId, view } from '@nkzw/fate';
import { act, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';
import { FateClient } from '../context.tsx';
import { useLiveListView } from '../useLiveListView.tsx';

// @ts-expect-error React 🤷‍♂️
global.IS_REACT_ACT_ENVIRONMENT = true;

type Post = {
  __typename: 'Post';
  comments?: Array<Comment>;
  content: string;
  id: string;
};

type Comment = {
  __typename: 'Comment';
  content: string;
  id: string;
  post?: Post | null;
};

test('renders like useListView and updates from live connection events', async () => {
  let handlers: any;
  const unsubscribe = vi.fn();
  const subscribeConnection = vi.fn(
    (_procedure, _type, _args, _select, _selectionArgs, nextHandlers) => {
      handlers = nextHandlers;
      return unsubscribe;
    },
  );
  const client = createClient({
    roots: {},
    transport: {
      async fetchById() {
        return [];
      },
      subscribeConnection,
    } as any,
    types: [{ type: 'Post' }],
  });

  const PostView = view<Post>()({
    content: true,
    id: true,
  });
  const PostConnectionView = {
    items: {
      cursor: true,
      node: PostView,
    },
    pagination: {
      hasNext: true,
      hasPrevious: true,
      nextCursor: true,
      previousCursor: true,
    },
  };

  const postId = toEntityId('Post', 'post-1');
  client.write(
    'Post',
    {
      __typename: 'Post',
      content: 'Apple',
      id: 'post-1',
    },
    new Set(['__typename', 'content', 'id']),
  );
  client.store.setList('posts', {
    cursors: ['cursor-1'],
    ids: [postId],
    pagination: {
      hasNext: false,
      hasPrevious: false,
    },
  });

  const posts = {
    items: [{ cursor: 'cursor-1', node: client.rootListRef(postId, PostView) }],
    pagination: {
      hasNext: false,
      hasPrevious: false,
    },
  };
  Object.defineProperty(posts, ConnectionTag, {
    value: {
      args: { after: 'cursor-1', first: 10, topic: 'fruit' },
      field: 'posts',
      key: 'posts',
      owner: 'posts',
      procedure: 'posts',
      root: true,
      type: 'Post',
    },
  });

  const Component = () => {
    const [items] = useLiveListView(PostConnectionView, posts);
    return <span>{items.map((item) => item.node.id).join(',')}</span>;
  };

  const container = document.createElement('div');
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );
  });

  expect(container.textContent).toBe('post-1');
  expect(subscribeConnection).toHaveBeenCalledWith(
    'posts',
    'Post',
    { topic: 'fruit' },
    expect.any(Set),
    undefined,
    expect.any(Object),
  );

  act(() => {
    handlers.onEvent({
      edge: {
        cursor: 'cursor-2',
        node: {
          __typename: 'Post',
          content: 'Banana',
          id: 'post-2',
        },
      },
      nodeType: 'Post',
      type: 'appendEdge',
    });
  });

  expect(container.textContent).toBe('post-1,post-2');

  await act(async () => {
    root.unmount();
  });

  await Promise.resolve();

  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test('does not render default edge appends while the connection has more pages', async () => {
  let handlers: any;
  const subscribeConnection = vi.fn(
    (_procedure, _type, _args, _select, _selectionArgs, nextHandlers) => {
      handlers = nextHandlers;
      return vi.fn();
    },
  );
  const client = createClient({
    roots: {},
    transport: {
      async fetchById() {
        return [];
      },
      subscribeConnection,
    } as any,
    types: [{ type: 'Post' }],
  });

  const PostView = view<Post>()({
    content: true,
    id: true,
  });
  const PostConnectionView = {
    items: {
      cursor: true,
      node: PostView,
    },
    pagination: {
      hasNext: true,
      hasPrevious: true,
      nextCursor: true,
      previousCursor: true,
    },
  };

  const postId = toEntityId('Post', 'post-1');
  client.write(
    'Post',
    {
      __typename: 'Post',
      content: 'Apple',
      id: 'post-1',
    },
    new Set(['__typename', 'content', 'id']),
  );
  client.store.setList('posts', {
    cursors: ['cursor-1'],
    ids: [postId],
    pagination: {
      hasNext: true,
      hasPrevious: false,
      nextCursor: 'cursor-1',
    },
  });

  const posts = {
    items: [{ cursor: 'cursor-1', node: client.rootListRef(postId, PostView) }],
    pagination: {
      hasNext: true,
      hasPrevious: false,
      nextCursor: 'cursor-1',
    },
  };
  Object.defineProperty(posts, ConnectionTag, {
    value: {
      args: { first: 10 },
      field: 'posts',
      key: 'posts',
      owner: 'posts',
      procedure: 'posts',
      root: true,
      type: 'Post',
    },
  });

  const Component = () => {
    const [items] = useLiveListView(PostConnectionView, posts);
    return <span>{items.map((item) => item.node.id).join(',')}</span>;
  };

  const container = document.createElement('div');
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );
  });

  expect(container.textContent).toBe('post-1');

  act(() => {
    handlers.onEvent({
      edge: {
        cursor: 'cursor-2',
        node: {
          __typename: 'Post',
          content: 'Banana',
          id: 'post-2',
        },
      },
      nodeType: 'Post',
      type: 'appendEdge',
    });
  });

  expect(container.textContent).toBe('post-1');
  expect(client.store.getListState('posts')).toMatchObject({
    ids: [postId],
    liveAfterIds: [toEntityId('Post', 'post-2')],
    pendingAfterIds: undefined,
  });

  await act(async () => {
    root.unmount();
  });
});

test('exposes loadNext for default edge appends when the exhausted connection is full', async () => {
  let handlers: any;
  let loadNextRef: (() => Promise<void>) | null = null;
  const subscribeConnection = vi.fn(
    (_procedure, _type, _args, _select, _selectionArgs, nextHandlers) => {
      handlers = nextHandlers;
      return vi.fn();
    },
  );
  const client = createClient({
    roots: {},
    transport: {
      async fetchById() {
        return [];
      },
      subscribeConnection,
    } as any,
    types: [{ type: 'Post' }],
  });

  const PostView = view<Post>()({
    content: true,
    id: true,
  });
  const PostConnectionView = {
    items: {
      cursor: true,
      node: PostView,
    },
    pagination: {
      hasNext: true,
      hasPrevious: true,
      nextCursor: true,
      previousCursor: true,
    },
  };

  const postId = toEntityId('Post', 'post-1');
  client.write(
    'Post',
    {
      __typename: 'Post',
      content: 'Apple',
      id: 'post-1',
    },
    new Set(['__typename', 'content', 'id']),
  );
  client.store.setList('posts', {
    cursors: ['cursor-1'],
    ids: [postId],
    pagination: {
      hasNext: false,
      hasPrevious: false,
    },
  });

  const posts = {
    items: [{ cursor: 'cursor-1', node: client.rootListRef(postId, PostView) }],
    pagination: {
      hasNext: false,
      hasPrevious: false,
    },
  };
  Object.defineProperty(posts, ConnectionTag, {
    value: {
      args: { first: 1 },
      field: 'posts',
      key: 'posts',
      owner: 'posts',
      procedure: 'posts',
      root: true,
      type: 'Post',
    },
  });

  const Component = () => {
    const [items, loadNext] = useLiveListView(PostConnectionView, posts);
    useEffect(() => {
      loadNextRef = loadNext;
    }, [loadNext]);
    return <span>{items.map((item) => item.node.id).join(',')}</span>;
  };

  const container = document.createElement('div');
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );
  });

  expect(container.textContent).toBe('post-1');
  expect(loadNextRef).toBeNull();

  await act(async () => {
    handlers.onEvent({
      edge: {
        cursor: 'cursor-2',
        node: {
          __typename: 'Post',
          content: 'Banana',
          id: 'post-2',
        },
      },
      nodeType: 'Post',
      type: 'appendEdge',
    });
  });

  expect(container.textContent).toBe('post-1');
  expect(loadNextRef).not.toBeNull();

  await act(async () => {
    root.unmount();
  });
});

test('keeps loadNext hidden when an already visible local append receives its live event', async () => {
  let handlers: any;
  let loadNextRef: (() => Promise<void>) | null = null;
  const subscribeConnection = vi.fn(
    (_procedure, _type, _args, _select, _selectionArgs, nextHandlers) => {
      handlers = nextHandlers;
      return vi.fn();
    },
  );
  const client = createClient({
    roots: {},
    transport: {
      async fetchById() {
        return [];
      },
      subscribeConnection,
    } as any,
    types: [
      { fields: { comments: { listOf: 'Comment' } }, type: 'Post' },
      { fields: { post: { type: 'Post' } }, type: 'Comment' },
    ],
  });

  const CommentView = view<Comment>()({
    content: true,
    id: true,
  });
  const CommentConnectionView = {
    args: { first: 1 },
    items: {
      cursor: true,
      node: CommentView,
    },
    live: {
      append: 'visible',
    },
    pagination: {
      hasNext: true,
      hasPrevious: true,
      nextCursor: true,
      previousCursor: true,
    },
  };

  const postId = toEntityId('Post', 'post-1');
  const commentOneId = toEntityId('Comment', 'comment-1');
  client.write(
    'Post',
    {
      __typename: 'Post',
      comments: [
        {
          __typename: 'Comment',
          content: 'Apple',
          id: 'comment-1',
        },
      ],
      content: 'Post',
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
  const listKey = client.store.getListsForField(postId, 'comments')[0]?.[0];
  if (!listKey) {
    throw new Error('Expected comments list to be registered.');
  }
  client.store.setList(listKey, {
    cursors: ['cursor-1'],
    ids: [commentOneId],
    pagination: {
      hasNext: false,
      hasPrevious: false,
    },
  });

  const comments = {
    items: [{ cursor: 'cursor-1', node: client.rootListRef(commentOneId, CommentView) }],
    pagination: {
      hasNext: false,
      hasPrevious: false,
    },
  };
  Object.defineProperty(comments, ConnectionTag, {
    value: {
      args: { first: 1, id: 'post-1' },
      field: 'comments',
      key: listKey,
      live: { append: 'visible' },
      owner: postId,
      procedure: 'Post.comments',
      root: false,
      type: 'Comment',
    },
  });

  const Component = () => {
    const [items, loadNext] = useLiveListView(CommentConnectionView, comments);
    useEffect(() => {
      loadNextRef = loadNext;
    }, [loadNext]);
    return <span>{items.map((item) => item.node.id).join(',')}</span>;
  };

  const container = document.createElement('div');
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );
  });

  expect(container.textContent).toBe('comment-1');
  expect(loadNextRef).toBeNull();

  await act(async () => {
    client.write(
      'Comment',
      {
        __typename: 'Comment',
        content: 'Banana',
        id: 'comment-2',
        post: { __typename: 'Post', id: 'post-1' },
      },
      new Set(['__typename', 'content', 'id', 'post', 'post.__typename', 'post.id']),
    );
  });

  expect(container.textContent).toBe('comment-1,comment-2');
  expect(loadNextRef).toBeNull();

  await act(async () => {
    handlers.onEvent({
      edge: {
        cursor: 'cursor-2',
        node: {
          __typename: 'Comment',
          content: 'Banana',
          id: 'comment-2',
        },
      },
      nodeType: 'Comment',
      type: 'appendEdge',
    });
  });

  expect(container.textContent).toBe('comment-1,comment-2');
  expect(loadNextRef).toBeNull();

  await act(async () => {
    root.unmount();
  });
});

test('keeps loadNext hidden when a visible live append extends an exhausted full connection', async () => {
  let handlers: any;
  let loadNextRef: (() => Promise<void>) | null = null;
  const subscribeConnection = vi.fn(
    (_procedure, _type, _args, _select, _selectionArgs, nextHandlers) => {
      handlers = nextHandlers;
      return vi.fn();
    },
  );
  const client = createClient({
    roots: {},
    transport: {
      async fetchById() {
        return [];
      },
      subscribeConnection,
    } as any,
    types: [
      { fields: { comments: { listOf: 'Comment' } }, type: 'Post' },
      { fields: { post: { type: 'Post' } }, type: 'Comment' },
    ],
  });

  const CommentView = view<Comment>()({
    content: true,
    id: true,
  });
  const CommentConnectionView = {
    args: { first: 1 },
    items: {
      cursor: true,
      node: CommentView,
    },
    live: {
      append: 'visible',
    },
    pagination: {
      hasNext: true,
      hasPrevious: true,
      nextCursor: true,
      previousCursor: true,
    },
  };

  const postId = toEntityId('Post', 'post-1');
  const commentOneId = toEntityId('Comment', 'comment-1');
  client.write(
    'Post',
    {
      __typename: 'Post',
      comments: [
        {
          __typename: 'Comment',
          content: 'Apple',
          id: 'comment-1',
        },
      ],
      content: 'Post',
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
  const listKey = client.store.getListsForField(postId, 'comments')[0]?.[0];
  if (!listKey) {
    throw new Error('Expected comments list to be registered.');
  }
  client.store.setList(listKey, {
    cursors: ['cursor-1'],
    ids: [commentOneId],
    pagination: {
      hasNext: false,
      hasPrevious: false,
    },
  });

  const comments = {
    items: [{ cursor: 'cursor-1', node: client.rootListRef(commentOneId, CommentView) }],
    pagination: {
      hasNext: false,
      hasPrevious: false,
    },
  };
  Object.defineProperty(comments, ConnectionTag, {
    value: {
      args: { first: 1, id: 'post-1' },
      field: 'comments',
      key: listKey,
      live: { append: 'visible' },
      owner: postId,
      procedure: 'Post.comments',
      root: false,
      type: 'Comment',
    },
  });

  const Component = () => {
    const [items, loadNext] = useLiveListView(CommentConnectionView, comments);
    useEffect(() => {
      loadNextRef = loadNext;
    }, [loadNext]);
    return <span>{items.map((item) => item.node.id).join(',')}</span>;
  };

  const container = document.createElement('div');
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );
  });

  expect(container.textContent).toBe('comment-1');
  expect(loadNextRef).toBeNull();

  await act(async () => {
    handlers.onEvent({
      edge: {
        cursor: 'cursor-2',
        node: {
          __typename: 'Comment',
          content: 'Banana',
          id: 'comment-2',
        },
      },
      nodeType: 'Comment',
      type: 'appendEdge',
    });
  });

  expect(container.textContent).toBe('comment-1,comment-2');
  expect(loadNextRef).toBeNull();

  await act(async () => {
    root.unmount();
  });
});
