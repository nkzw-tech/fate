/**
 * @vitest-environment happy-dom
 */

import { createClient, view } from '@nkzw/fate';
import { act, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
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
    transport: { fetchById },
    types: [{ type: 'Post' }],
  });

  const PostView = view<Post>()({
    id: true,
  });

  const request = { post: { ids: ['post-1'], type: 'Post' as const, view: PostView } };
  const releaseSpy = vi.spyOn(client, 'releaseRequest');

  const Component = () => {
    useRequest(request, { mode: 'network-only' });
    return <span>Post</span>;
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

    await flushAsync();
  });

  expect(fetchById).toHaveBeenCalledTimes(1);
  expect(releaseSpy).not.toHaveBeenCalled();

  await act(async () => {
    root.unmount();
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

  const client = createClient({
    transport: { fetchById },
    types: [{ type: 'Post' }],
  });

  const PostView = view<Post>()({
    content: true,
    id: true,
  });

  const request = { post: { id: 'post-1', type: 'Post' as const, view: PostView } };
  const renders: Array<string> = [];

  const Component = () => {
    const { post: postRef } = useRequest(request);
    const post = useView(PostView, postRef);
    renders.push(post.content);
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

  expect(renders).toEqual(['Apple']);
  expect(fetchById).toHaveBeenCalledTimes(1);
});
