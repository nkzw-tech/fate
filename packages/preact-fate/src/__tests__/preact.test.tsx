/**
 * @vitest-environment happy-dom
 */

import { clientRoot, createClient, view, type ViewRef } from '@nkzw/fate';
import { Component, type ComponentChildren } from 'preact';
import { expect, test, vi } from 'vite-plus/test';
import { FateClient, Suspense, useRequest, useView } from '../index.ts';
import { act, createRoot } from './preact.ts';

type Post = { __typename: 'Post'; content: string; id: string };

const PostView = view<Post>()({ content: true, id: true });

const controlledFetch = () => {
  const pending = new Map<string, PromiseWithResolvers<Array<Post>>>();
  const fetchById = vi.fn((_type: string, ids: ReadonlyArray<string | number>) => {
    const deferred = Promise.withResolvers<Array<Post>>();
    pending.set(String(ids[0]), deferred);
    return deferred.promise;
  });
  const settle = (id: string) =>
    act(async () => {
      pending.get(id)!.resolve([{ __typename: 'Post', content: `Post ${id}`, id }]);
    });
  const fail = (id: string, error: Error) =>
    act(async () => {
      pending.get(id)!.reject(error);
    });
  return { fail, fetchById, settle };
};

function PostCard({ postRef }: { postRef: ViewRef<'Post'> }) {
  return <span>{useView(PostView, postRef).content}</span>;
}

class ErrorBoundary extends Component<{ children?: ComponentChildren }, { error: unknown }> {
  override state = { error: null as unknown };
  override componentDidCatch(error: unknown) {
    this.setState({ error });
  }
  override render() {
    return this.state.error ? `error: ${(this.state.error as Error).message}` : this.props.children;
  }
}

test('keeps showing the previous request result while a changed request loads', async () => {
  const { fetchById, settle } = controlledFetch();
  const roots = { post: clientRoot('Post') };
  const client = createClient<[typeof roots, Record<never, never>]>({
    roots,
    transport: { fetchById },
    types: [{ type: 'Post' }],
  });

  function PostScreen({ id }: { id: string }) {
    const request = { post: { id, view: PostView } };
    const { post } = useRequest<typeof request, typeof roots>(request);
    return <span>{useView(PostView, post).content}</span>;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  const render = (id: string) =>
    act(async () =>
      root.render(
        <FateClient client={client}>
          <Suspense fallback="loading">
            <PostScreen id={id} />
          </Suspense>
        </FateClient>,
      ),
    );

  await render('1');
  expect(container.textContent).toBe('loading');
  await settle('1');
  expect(container.textContent).toBe('Post 1');

  await render('2');
  expect(container.textContent).toBe('Post 1');
  await settle('2');
  expect(container.textContent).toBe('Post 2');

  await act(async () => root.unmount());
});

test('subscribes to a view ref that resolved while previous data was shown', async () => {
  const { fetchById, settle } = controlledFetch();
  const client = createClient({
    roots: {},
    transport: { fetchById },
    types: [{ type: 'Post' }],
  });
  client.write(
    'Post',
    { __typename: 'Post', content: 'Post 1', id: '1' },
    new Set(['content', 'id']),
  );

  const container = document.createElement('div');
  const root = createRoot(container);
  const render = (id: string) =>
    act(async () =>
      root.render(
        <FateClient client={client}>
          <Suspense fallback="loading">
            <PostCard postRef={client.ref<Post>('Post', id, PostView)} />
          </Suspense>
        </FateClient>,
      ),
    );

  await render('1');
  expect(container.textContent).toBe('Post 1');

  await render('2');
  expect(container.textContent).toBe('Post 1');
  await settle('2');
  expect(container.textContent).toBe('Post 2');

  await act(async () => {
    client.write(
      'Post',
      { __typename: 'Post', content: 'Post 2 (edited)', id: '2' },
      new Set(['content']),
    );
  });
  expect(container.textContent).toBe('Post 2 (edited)');

  await act(async () => root.unmount());
});

test('request errors pass through Suspense to the next error boundary', async () => {
  const { fail, fetchById } = controlledFetch();
  const roots = { post: clientRoot('Post') };
  const client = createClient<[typeof roots, Record<never, never>]>({
    roots,
    transport: { fetchById },
    types: [{ type: 'Post' }],
  });

  function PostScreen() {
    const request = { post: { id: '1', view: PostView } };
    const { post } = useRequest<typeof request, typeof roots>(request);
    return <span>{useView(PostView, post).content}</span>;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <FateClient client={client}>
        <ErrorBoundary>
          <Suspense fallback="loading">
            <PostScreen />
          </Suspense>
        </ErrorBoundary>
      </FateClient>,
    ),
  );
  expect(container.textContent).toBe('loading');

  await fail('1', new Error('Network down'));
  expect(container.textContent).toBe('error: Network down');

  await act(async () => root.unmount());
});
