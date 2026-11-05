/** @vitest-environment happy-dom */
import { createClient, defer, view } from '@nkzw/fate';
import { act, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vite-plus/test';
import { FateClient } from '../context.tsx';
import { useListView } from '../useListView.tsx';
// @ts-expect-error test setup
global.IS_REACT_ACT_ENVIRONMENT = true;

test('deferred live errors should reach boundary without retrying', async () => {
  const { Component } = await import('react');
  const { vi } = await import('vite-plus/test');
  const { useLiveView } = await import('../useLiveView.tsx');
  class Boundary extends Component<any, any> {
    state = { error: null };
    static getDerivedStateFromError(error: any) {
      return { error };
    }
    render() {
      return this.state.error ? this.state.error.message : this.props.children;
    }
  }
  type User = { __typename: 'User'; id: string; name: string; friend: User };
  const UserView = view<User>()({ id: true, name: true });
  const ParentView = view<User>()({ friend: defer(UserView) });
  const first = Promise.withResolvers<Array<Record<string, unknown>>>();
  const retry = Promise.withResolvers<Array<Record<string, unknown>>>();
  const fetchById = vi.fn(() => retry.promise).mockReturnValueOnce(first.promise);
  const client = createClient({
    roots: {},
    transport: { fetchById, subscribeById: () => () => {} },
    types: [{ type: 'User', fields: { friend: { type: 'User' } } }],
  });
  client.write('User', { id: 'p' }, new Set(['id']));
  const parent = await client.readView(ParentView, client.ref('User', 'p', ParentView));
  const Child = () => useLiveView(UserView, parent.data.friend)?.name;
  const container = document.createElement('div');
  const root = createRoot(container, { onCaughtError: vi.fn() });
  try {
    await act(async () =>
      root.render(
        <FateClient client={client}>
          <Boundary>
            <Suspense fallback="loading">
              <Child />
            </Suspense>
          </Boundary>
        </FateClient>,
      ),
    );
    expect(fetchById).toHaveBeenCalledTimes(1);
    await act(async () => first.reject(new Error('Initial failed')));
    expect(container.textContent).toBe('Initial failed');
    expect(fetchById).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
  }
});

test.each(['list', 'live-list'] as const)(
  'deferred %s errors should reach boundary without retrying',
  async (kind) => {
    const { Component } = await import('react');
    const { vi } = await import('vite-plus/test');
    const { useLiveListView } = await import('../useLiveListView.tsx');
    class Boundary extends Component<any, any> {
      state = { error: null };
      static getDerivedStateFromError(error: any) {
        return { error };
      }
      render() {
        return this.state.error ? this.state.error.message : this.props.children;
      }
    }
    type Comment = { __typename: 'Comment'; id: string; content: string };
    type Post = { __typename: 'Post'; id: string; comments: Array<Comment> | null };
    const CommentView = view<Comment>()({ id: true, content: true });
    const connection = {
      args: { first: 1 },
      items: { cursor: true, node: CommentView },
      pagination: { hasNext: true, hasPrevious: true, nextCursor: true, previousCursor: true },
    } as const;
    const PostView = view<Post>()({ id: true, comments: defer(connection) });
    const first = Promise.withResolvers<Array<Record<string, unknown>>>();
    const retry = Promise.withResolvers<Array<Record<string, unknown>>>();
    const fetchById = vi.fn(() => retry.promise).mockReturnValueOnce(first.promise);
    const client = createClient({
      roots: {},
      transport: { fetchById, subscribeConnection: () => () => {} },
      types: [{ type: 'Post', fields: { comments: { listOf: 'Comment' } } }, { type: 'Comment' }],
    });
    client.write('Post', { id: 'p' }, new Set(['id']));
    const parent = await client.readView(PostView, client.ref('Post', 'p', PostView));
    const hook = kind === 'list' ? useListView : useLiveListView;
    const Child = () => {
      const [items] = hook(connection, parent.data.comments);
      return items?.length;
    };
    const container = document.createElement('div');
    const root = createRoot(container, { onCaughtError: vi.fn() });
    try {
      await act(async () =>
        root.render(
          <FateClient client={client}>
            <Boundary>
              <Suspense fallback="loading">
                <Child />
              </Suspense>
            </Boundary>
          </FateClient>,
        ),
      );
      expect(fetchById).toHaveBeenCalledTimes(1);
      await act(async () => first.reject(new Error('Initial failed')));
      expect(container.textContent).toBe('Initial failed');
      expect(fetchById).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
    }
  },
);
