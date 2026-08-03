/**
 * @vitest-environment happy-dom
 */

import { clientRoot, createClient, view, type ViewRef } from '@nkzw/fate';
import { act, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';
import { FateClient } from '../context.tsx';
import { useLiveListView } from '../useLiveListView.tsx';
import { useLiveView } from '../useLiveView.tsx';
import { useRequest } from '../useRequest.tsx';

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

test('deleting the final live item does not loop', async () => {
  let deletePost: ((id?: string | number) => void) | undefined;
  const client = createClient({
    roots: {
      posts: clientRoot<
        {
          items: ReadonlyArray<{
            node: Post;
          }>;
        },
        'Post'
      >('Post'),
    },
    transport: {
      async fetchById() {
        return [];
      },
      async fetchList() {
        return {
          items: [
            {
              cursor: 'post-1',
              node: {
                __typename: 'Post' as const,
                content: 'Apple',
                id: 'post-1',
              },
            },
          ],
          pagination: {
            hasNext: false,
            hasPrevious: false,
          },
        };
      },
      subscribeById: (_type, _id, _select, _args, handlers) => {
        deletePost = handlers.onDelete;
        return () => {};
      },
      subscribeConnection: () => () => {},
    },
    types: [{ type: 'Post' }],
  });

  const PostView = view<Post>()({
    content: true,
    id: true,
  });
  const PostConnectionView = {
    items: { node: PostView },
    live: { append: 'visible' as const },
  };

  await client.request({
    posts: { list: PostConnectionView },
  });

  const PostContent = ({ postRef }: { postRef: ViewRef<'Post'> }) => {
    const post = useLiveView(PostView, postRef);
    return <span>{post.content}</span>;
  };

  const PostList = () => {
    const request = useRequest({
      posts: { list: PostConnectionView },
    });
    const [posts] = useLiveListView(PostConnectionView, request.posts);

    return posts.length ? (
      posts.map(({ node }) => <PostContent key={node.id} postRef={node} />)
    ) : (
      <span>No posts</span>
    );
  };

  const container = document.createElement('div');
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <StrictMode>
        <FateClient client={client}>
          <Suspense fallback={null}>
            <PostList />
          </Suspense>
        </FateClient>
      </StrictMode>,
    );
  });

  expect(container.textContent).toBe('Apple');
  expect(deletePost).toBeTypeOf('function');

  await act(async () => {
    deletePost?.('post-1');
  });

  expect(container.textContent).toBe('No posts');

  await act(async () => {
    root.unmount();
  });
});
