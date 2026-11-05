/** @vitest-environment happy-dom */
import { createClient, defer, view, type ViewSelection } from '@nkzw/fate';
import { act, Component, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vite-plus/test';
import { FateClient } from '../context.tsx';
import { useListView } from '../useListView.tsx';
// @ts-expect-error test setup
global.IS_REACT_ACT_ENVIRONMENT = true;

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    return this.state.error?.message ?? this.props.children;
  }
}

test('deferred live errors should reach boundary without retrying', async () => {
  const { vi } = await import('vite-plus/test');
  const { useLiveView } = await import('../useLiveView.tsx');
  type User = { __typename: 'User'; friend: User; id: string; name: string };
  const UserView = view<User>()({ id: true, name: true });
  const ParentView = view<User>()({ friend: defer(UserView) });
  const first = Promise.withResolvers<Array<Record<string, unknown>>>();
  const retry = Promise.withResolvers<Array<Record<string, unknown>>>();
  const fetchById = vi.fn(() => retry.promise).mockReturnValueOnce(first.promise);
  const client = createClient({
    roots: {},
    transport: { fetchById, subscribeById: () => () => {} },
    types: [{ fields: { friend: { type: 'User' } }, type: 'User' }],
  });
  client.write('User', { id: 'p' }, new Set(['id']));
  const parent = await client.readView<User, ViewSelection<typeof ParentView>, typeof ParentView>(
    ParentView,
    client.ref('User', 'p', ParentView),
  );
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
    const { vi } = await import('vite-plus/test');
    const { useLiveListView } = await import('../useLiveListView.tsx');
    type Comment = { __typename: 'Comment'; content: string; id: string };
    type Post = { __typename: 'Post'; comments: Array<Comment> | null; id: string };
    const CommentView = view<Comment>()({ content: true, id: true });
    const connection = {
      args: { first: 1 },
      items: { cursor: true, node: CommentView },
      pagination: { hasNext: true, hasPrevious: true, nextCursor: true, previousCursor: true },
    } as const;
    const PostView = view<Post>()({ comments: defer(connection), id: true });
    const first = Promise.withResolvers<Array<Record<string, unknown>>>();
    const retry = Promise.withResolvers<Array<Record<string, unknown>>>();
    const fetchById = vi.fn(() => retry.promise).mockReturnValueOnce(first.promise);
    const client = createClient({
      roots: {},
      transport: { fetchById, subscribeConnection: () => () => {} },
      types: [{ fields: { comments: { listOf: 'Comment' } }, type: 'Post' }, { type: 'Comment' }],
    });
    client.write('Post', { id: 'p' }, new Set(['id']));
    const parent = await client.readView<Post, ViewSelection<typeof PostView>, typeof PostView>(
      PostView,
      client.ref('Post', 'p', PostView),
    );
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
