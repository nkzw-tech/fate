/**
 * @vitest-environment happy-dom
 */

import { clientRoot, createClient, view } from '@nkzw/fate';
import { Component, type ComponentChildren } from 'preact';
import { expect, test, vi } from 'vite-plus/test';
import { FateClient, lazy, Suspense, useRequest, useView } from '../index.ts';
import { act, createRoot } from './preact.ts';

type Post = { __typename: 'Post'; content: string; id: string };
const PostView = view<Post>()({ content: true, id: true });

class ErrorBoundary extends Component<{ children?: ComponentChildren }, { error: unknown }> {
  override state = { error: null as unknown };
  override componentDidCatch(error: unknown) {
    this.setState({ error });
  }
  override render() {
    return this.state.error ? 'error boundary caught' : this.props.children;
  }
}

test('error boundaries inside Suspense do not catch pending fate data', async () => {
  const { promise, resolve } = Promise.withResolvers<Array<Post>>();
  const roots = { post: clientRoot('Post') };
  const client = createClient<[typeof roots, Record<never, never>]>({
    roots,
    transport: { fetchById: vi.fn(() => promise) },
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
        <Suspense fallback="loading">
          <ErrorBoundary>
            <PostScreen />
          </ErrorBoundary>
        </Suspense>
      </FateClient>,
    ),
  );
  const whileLoading = container.textContent;

  await act(async () => resolve([{ __typename: 'Post', content: 'Post 1', id: '1' }]));
  const afterLoad = container.textContent;

  expect({ afterLoad, whileLoading }).toEqual({ afterLoad: 'Post 1', whileLoading: 'loading' });
  await act(async () => root.unmount());
});

test('failed lazy imports reach the error boundary', async () => {
  const { promise, reject } = Promise.withResolvers<{ default: () => string }>();
  const load = vi.fn(() => promise);
  const Lazy = lazy(load);

  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <ErrorBoundary>
        <Suspense fallback="loading">
          <Lazy />
        </Suspense>
      </ErrorBoundary>,
    ),
  );
  const whileLoading = container.textContent;

  await act(async () => reject(new Error('Failed to fetch dynamically imported module')));
  const afterFailure = container.textContent;

  expect({ afterFailure, loads: load.mock.calls.length, whileLoading }).toEqual({
    afterFailure: 'error boundary caught',
    loads: 1,
    whileLoading: 'loading',
  });
  await act(async () => root.unmount());
});
