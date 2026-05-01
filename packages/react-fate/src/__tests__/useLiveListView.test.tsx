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
  content: string;
  id: string;
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
