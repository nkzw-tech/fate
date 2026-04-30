/**
 * @vitest-environment happy-dom
 */

import { createClient, view, type ViewRef } from '@nkzw/fate';
import { act, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';
import { FateClient } from '../context.tsx';
import { useLiveView } from '../useLiveView.tsx';

// @ts-expect-error React 🤷‍♂️
global.IS_REACT_ACT_ENVIRONMENT = true;

type Post = {
  __typename: 'Post';
  content: string;
  id: string;
};

test('renders like useView and updates from live subscription data', async () => {
  let handlers: any;
  const unsubscribe = vi.fn();
  const subscribeById = vi.fn((_type, _id, _select, _args, nextHandlers) => {
    handlers = nextHandlers;
    return unsubscribe;
  });
  const client = createClient({
    roots: {},
    transport: {
      async fetchById() {
        return [];
      },
      subscribeById,
    } as any,
    types: [{ type: 'Post' }],
  });

  client.write(
    'Post',
    {
      __typename: 'Post',
      content: 'Apple',
      id: 'post-1',
    },
    new Set(['__typename', 'content', 'id']),
  );

  const PostView = view<Post>()({
    content: true,
    id: true,
  });
  const postRef = client.ref<Post>('Post', 'post-1', PostView);

  const Component = () => {
    const post = useLiveView(PostView, postRef);
    return <span>{post.content}</span>;
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

  expect(container.textContent).toBe('Apple');
  expect(subscribeById).toHaveBeenCalledTimes(1);

  act(() => {
    handlers.onData({
      __typename: 'Post',
      content: 'Banana',
      id: 'post-1',
    });
  });

  expect(container.textContent).toBe('Banana');

  await act(async () => {
    root.unmount();
  });

  await Promise.resolve();

  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test('does not subscribe for null refs', async () => {
  const subscribeById = vi.fn(() => vi.fn());
  const client = createClient({
    roots: {},
    transport: {
      async fetchById() {
        return [];
      },
      subscribeById,
    } as any,
    types: [{ type: 'Post' }],
  });

  const PostView = view<Post>()({
    content: true,
    id: true,
  });

  const Component = () => {
    const post = useLiveView(PostView, null as ViewRef<'Post'> | null);
    return <span>{post?.content ?? 'empty'}</span>;
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

  expect(container.textContent).toBe('empty');
  expect(subscribeById).not.toHaveBeenCalled();

  await act(async () => {
    root.unmount();
  });
});

test('keeps the same live subscription when ref identity changes for the same entity', async () => {
  const unsubscribe = vi.fn();
  const subscribeById = vi.fn(() => unsubscribe);
  const client = createClient({
    roots: {},
    transport: {
      async fetchById() {
        return [];
      },
      subscribeById,
    } as any,
    types: [{ type: 'Post' }],
  });

  client.write(
    'Post',
    {
      __typename: 'Post',
      content: 'Apple',
      id: 'post-1',
    },
    new Set(['__typename', 'content', 'id']),
  );

  const PostView = view<Post>()({
    content: true,
    id: true,
  });

  const Component = ({ postRef }: { postRef: ViewRef<'Post'> }) => {
    const post = useLiveView(PostView, postRef);
    return <span>{post.content}</span>;
  };

  const container = document.createElement('div');
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component postRef={client.ref<Post>('Post', 'post-1', PostView)} />
        </Suspense>
      </FateClient>,
    );
  });

  expect(container.textContent).toBe('Apple');
  expect(subscribeById).toHaveBeenCalledTimes(1);

  await act(async () => {
    root.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component postRef={client.ref<Post>('Post', 'post-1', PostView)} />
        </Suspense>
      </FateClient>,
    );
  });

  expect(container.textContent).toBe('Apple');
  expect(subscribeById).toHaveBeenCalledTimes(1);
  expect(unsubscribe).not.toHaveBeenCalled();

  await act(async () => {
    root.unmount();
  });

  await Promise.resolve();

  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
