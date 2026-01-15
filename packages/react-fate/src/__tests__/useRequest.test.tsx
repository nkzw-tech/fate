/**
 * @vitest-environment happy-dom
 */

import { createClient, clientRoot, view, ViewRef } from '@nkzw/fate';
import { act, Suspense } from 'react';
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
  const releaseSpy = vi.spyOn(client, 'releaseRequest');

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

  expect(releaseSpy).toHaveBeenCalledWith(request, 'network-only');
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
