/**
 * @vitest-environment happy-dom
 */

import { createClient, clientRoot, toEntityId, view, ViewRef } from '@nkzw/fate';
import { act, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { FateClient } from '../context.tsx';
import { useView } from '../index.tsx';
import { useRequest } from '../useRequest.tsx';

// @ts-expect-error React 🤷‍♂️
global.IS_REACT_ACT_ENVIRONMENT = true;

type Post = { __typename: 'Post'; content: string; id: string };

const flushAsync = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('releases network-only requests on unmount', async () => {
  const fetchById = vi.fn().mockResolvedValue([
    {
      __typename: 'Post',
      id: 'post-1',
    },
  ]);

  const client = createClient({
    roots: {
      post: clientRoot('Post'),
    },
    transport: { fetchById },
    types: [{ type: 'Post' }],
  });

  const PostView = view<Post>()({
    id: true,
  });

  const request = { post: { ids: ['post-1'], view: PostView } };
  const requestKey = client.getRequestKey(request);
  const releaseSpy = vi.spyOn(client, 'releaseRequestKey');

  const Component = () => {
    useRequest(request, { mode: 'network-only' });
    return <span>Post</span>;
  };

  const container = document.createElement('div');
  const reactRoot = createRoot(container);

  await act(async () => {
    reactRoot.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );

    await flushAsync();
  });

  expect(fetchById).toHaveBeenCalledTimes(1);
  expect(releaseSpy).not.toHaveBeenCalled();

  await act(async () => {
    reactRoot.unmount();
    await flushAsync();
  });

  expect(releaseSpy).toHaveBeenCalledWith(requestKey, 'network-only');
});

test('retains cache-first requests while mounted and disposes them on unmount', async () => {
  const fetchById = vi.fn().mockResolvedValue([
    {
      __typename: 'Post',
      content: 'Apple',
      id: 'post-1',
    },
  ]);

  const client = createClient({
    gcReleaseBufferSize: 0,
    roots: {
      post: clientRoot('Post'),
    },
    transport: { fetchById },
    types: [{ fields: { content: 'scalar' }, type: 'Post' }],
  });

  const PostView = view<Post>()({
    content: true,
    id: true,
  });

  const request = { post: { id: 'post-1', view: PostView } };
  const postId = toEntityId('Post', 'post-1');

  const Component = () => {
    useRequest(request);
    return <span>Post</span>;
  };

  const container = document.createElement('div');
  const reactRoot = createRoot(container);

  await act(async () => {
    reactRoot.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );

    await flushAsync();
  });

  expect(client.store.read(postId)).toMatchObject({ content: 'Apple' });

  await act(async () => {
    reactRoot.unmount();
    await flushAsync();
  });

  expect(client.store.read(postId)).toBeUndefined();
});

test('supports requesting a single node through `byId` calls', async () => {
  const fetchById = vi.fn().mockResolvedValue([
    {
      __typename: 'Post',
      content: 'Apple',
      id: 'post-1',
    },
  ]);

  const roots = {
    post: clientRoot('Post'),
  };
  const mutations = {};

  const client = createClient<[typeof roots, typeof mutations]>({
    roots,
    transport: { fetchById },
    types: [{ type: 'Post' }],
  });

  const PostView = view<Post>()({
    content: true,
    id: true,
  });

  const request = { post: { id: 'post-1', view: PostView } };
  const renders: Array<string> = [];

  const Component = () => {
    const { post: postRef } = useRequest<typeof request, typeof roots>(request);
    const post = useView(PostView, postRef);
    renders.push(post.content);
    return <span>{post.content}</span>;
  };

  const container = document.createElement('div');
  const reactRoot = createRoot(container);

  await act(async () => {
    reactRoot.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );
  });

  expect(renders).toEqual(['Apple']);
  expect(fetchById).toHaveBeenCalledTimes(1);
});

test('does not refetch network-only inline requests during rerenders with the same key', async () => {
  const fetchById = vi.fn().mockResolvedValue([
    {
      __typename: 'Post',
      content: 'Apple',
      id: 'post-1',
    },
  ]);

  const client = createClient({
    roots: {
      post: clientRoot('Post'),
    },
    transport: { fetchById },
    types: [{ type: 'Post' }],
  });

  const PostView = view<Post>()({
    content: true,
    id: true,
  });
  let rerender: (() => void) | undefined;

  const Component = () => {
    const [count, setCount] = useState(0);
    rerender = () => setCount((value) => value + 1);
    useRequest(
      {
        post: { id: 'post-1', view: PostView },
      },
      { mode: 'network-only' },
    );
    return <span>{count}</span>;
  };

  const container = document.createElement('div');
  const reactRoot = createRoot(container);

  await act(async () => {
    reactRoot.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );

    await flushAsync();
  });

  await act(async () => {
    rerender?.();
    await flushAsync();
  });

  expect(fetchById).toHaveBeenCalledTimes(1);
});

test('refetches network-only inline requests when the request key changes', async () => {
  const fetchById = vi.fn(async (_type: string, ids: Array<string | number>) =>
    ids.map((id) => ({
      __typename: 'Post',
      content: `Post ${id}`,
      id: String(id),
    })),
  );

  const client = createClient({
    roots: {
      post: clientRoot('Post'),
    },
    transport: { fetchById },
    types: [{ type: 'Post' }],
  });

  const PostView = view<Post>()({
    content: true,
    id: true,
  });
  let setPostId: ((id: string) => void) | undefined;

  const Component = () => {
    const [postId, setStatePostId] = useState('post-1');
    setPostId = setStatePostId;
    const { post } = useRequest(
      {
        post: { id: postId, view: PostView },
      },
      { mode: 'network-only' },
    );
    return <span>{post.id}</span>;
  };

  const container = document.createElement('div');
  const reactRoot = createRoot(container);

  await act(async () => {
    reactRoot.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );

    await flushAsync();
  });

  await act(async () => {
    setPostId?.('post-2');
    await flushAsync();
  });

  expect(fetchById).toHaveBeenCalledTimes(2);
  expect(fetchById).toHaveBeenNthCalledWith(
    1,
    'Post',
    ['post-1'],
    new Set(['content', 'id']),
    undefined,
  );
  expect(fetchById).toHaveBeenNthCalledWith(
    2,
    'Post',
    ['post-2'],
    new Set(['content', 'id']),
    undefined,
  );
});

test('makes regular queries nullable or not depending on the root types', async () => {
  type User = { __typename: 'User'; id: string; name: string };

  const roots = {
    user: clientRoot<User, 'User'>('User'),
    viewer: clientRoot<User | null, 'User'>('User'),
  };

  const UserView = view<User>()({
    id: true,
    name: true,
  });

  const request = { user: { view: UserView }, viewer: { view: UserView } };

  const Component = () => {
    const { user, viewer } = useRequest<typeof request, typeof roots>({
      user: { view: UserView },
      viewer: { view: UserView },
    });

    expectTypeOf(user).toEqualTypeOf<ViewRef<'User'>>();
    expectTypeOf(viewer).toEqualTypeOf<ViewRef<'User'> | null>();
  };

  // eslint-disable-next-line no-unused-expressions, @typescript-eslint/no-unused-expressions
  Component;
});
