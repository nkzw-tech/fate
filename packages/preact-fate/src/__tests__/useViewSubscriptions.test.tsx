/** @vitest-environment happy-dom */

import { clientRoot, createClient, defer, toEntityId, view, type ViewRef } from '@nkzw/fate';
import { Component as ReactComponent, type ComponentChildren as ReactNode } from 'preact';
import { expect, test, vi } from 'vite-plus/test';
import { FateClient } from '../context.ts';
import { useView } from '../useView.ts';
import { act, createRoot, StrictMode, Suspense } from './preact.ts';

type User = { __typename: 'User'; id: string; name: string };
type Post = { __typename: 'Post'; author: User; content: string; id: string };

class ErrorBoundary extends ReactComponent<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static override getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error ? <span>{this.state.error.message}</span> : this.props.children;
  }
}

test.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])(
  'ignores pending reads after changing refs or unmounting (StrictMode: %s, rejection: %s)',
  async (strict, rejection) => {
    const second = Promise.withResolvers<Array<Partial<Post>>>();
    const fourth = Promise.withResolvers<Array<Partial<Post>>>();
    const client = createClient({
      roots: {},
      transport: {
        fetchById: vi.fn((_type, ids) => {
          if (ids[0] === 'post-2') {
            return second.promise;
          }
          if (ids[0] === 'post-4') {
            return fourth.promise;
          }
          throw new Error(`Unexpected fetch: ${ids[0]}`);
        }),
      },
      types: [{ type: 'Post' }],
    });
    const PostView = view<Post>()({ content: true, id: true });
    const paths = new Set(['content', 'id']);
    client.write('Post', { __typename: 'Post', content: 'Apple', id: 'post-1' }, paths);
    client.write('Post', { __typename: 'Post', content: 'Kiwi', id: 'post-3' }, paths);
    const subscribe = vi.spyOn(client.store, 'subscribe');
    const Component = ({ postRef }: { postRef: ViewRef<'Post'> }) => (
      <span>{useView(PostView, postRef).content}</span>
    );
    const container = document.createElement('div');
    const root = createRoot(container);
    const render = (id: string) =>
      act(async () => {
        const component = (
          <FateClient client={client}>
            <Suspense fallback={null}>
              <Component postRef={client.ref<Post>('Post', id, PostView)} />
            </Suspense>
          </FateClient>
        );
        root.render(strict ? <StrictMode>{component}</StrictMode> : component);
      });

    await render('post-1');
    await render('post-2');
    expect(container.textContent).toBe('Apple');
    await render('post-3');
    expect(container.textContent).toBe('Kiwi');
    const subscriptionsBeforeResolution = subscribe.mock.calls.length;
    await act(async () => {
      second.resolve([{ __typename: 'Post', content: 'Banana', id: 'post-2' }]);
    });
    expect(container.textContent).toBe('Kiwi');
    expect(subscribe).toHaveBeenCalledTimes(subscriptionsBeforeResolution);

    await act(async () => {
      client.write('Post', { __typename: 'Post', content: 'Orange', id: 'post-3' }, paths);
    });
    expect(container.textContent).toBe('Orange');

    await render('post-4');
    expect(container.textContent).toBe('Orange');
    await act(async () => root.unmount());
    const subscriptionsBeforeUnmountedResolution = subscribe.mock.calls.length;
    await act(async () => {
      if (rejection) {
        fourth.reject(new Error('Unmounted request failed'));
      } else {
        fourth.resolve([{ __typename: 'Post', content: 'Grape', id: 'post-4' }]);
      }
    });
    expect(subscribe).toHaveBeenCalledTimes(subscriptionsBeforeUnmountedResolution);
  },
);

test('refreshes coverage after a subscribed ref needs to load again', async () => {
  const request = Promise.withResolvers<Array<Partial<Post>>>();
  const fetchById = vi.fn(() => request.promise);
  const client = createClient({
    roots: {},
    transport: { fetchById },
    types: [{ fields: { author: { type: 'User' } }, type: 'Post' }, { type: 'User' }],
  });
  const PostView = view<Post>()({ author: { id: true, name: true }, id: true });
  client.write(
    'Post',
    {
      __typename: 'Post',
      author: { __typename: 'User', id: 'user-1', name: 'Apple' },
      id: 'post-1',
    },
    new Set(['author.id', 'author.name', 'id']),
  );
  const postRef = client.ref<Post>('Post', 'post-1', PostView);
  const Component = () => <span>{useView(PostView, postRef).author.name}</span>;
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
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
    await act(async () => {
      client.store.deleteRecord(toEntityId('Post', 'post-1'));
      client.write(
        'Post',
        { __typename: 'Post', author: { __typename: 'User', id: 'user-2' }, id: 'post-1' },
        new Set(['author.id']),
      );
    });
    expect(fetchById).toHaveBeenCalledTimes(1);
    await act(async () => {
      request.resolve([
        {
          __typename: 'Post',
          author: { __typename: 'User', id: 'user-2', name: 'Banana' },
          id: 'post-1',
        },
      ]);
    });
    expect(container.textContent).toBe('Banana');
    await act(async () => {
      client.write('User', { __typename: 'User', id: 'user-2', name: 'Kiwi' }, new Set(['name']));
    });
    expect(container.textContent).toBe('Kiwi');
  } finally {
    await act(async () => root.unmount());
  }
});

test('reports a rejected pending read to an error boundary', async () => {
  const request = Promise.withResolvers<Array<Partial<Post>>>();
  const client = createClient({
    roots: {},
    transport: { fetchById: vi.fn(() => request.promise) },
    types: [{ type: 'Post' }],
  });
  const PostView = view<Post>()({ content: true, id: true });
  client.write(
    'Post',
    { __typename: 'Post', content: 'Apple', id: 'post-1' },
    new Set(['content', 'id']),
  );
  const Component = ({ postRef }: { postRef: ViewRef<'Post'> }) => (
    <span>{useView(PostView, postRef).content}</span>
  );
  const container = document.createElement('div');
  const root = createRoot(container, { onCaughtError: vi.fn() });
  const render = (id: string) =>
    act(async () => {
      root.render(
        <ErrorBoundary>
          <FateClient client={client}>
            <Suspense fallback={null}>
              <Component postRef={client.ref<Post>('Post', id, PostView)} />
            </Suspense>
          </FateClient>
        </ErrorBoundary>,
      );
    });
  try {
    await render('post-1');
    await render('post-2');
    await act(async () => request.reject(new Error('Request failed')));
    expect(container.textContent).toBe('Request failed');
  } finally {
    await act(async () => root.unmount());
  }
});

test('reports synchronous cache-only snapshot errors to an error boundary after a write', async () => {
  const fetchById = vi.fn(async () => []);
  const roots = { viewer: clientRoot<User, 'User'>('User') };
  const client = createClient<[typeof roots, Record<never, never>]>({
    roots,
    transport: { fetchById },
    types: [{ type: 'User' }],
  });
  const UserView = view<User>()({ id: true, name: true });
  client.write('User', { id: '1', name: 'Apple' }, new Set(['id', 'name']));
  const observer = client.observeRequest(
    { viewer: { id: '1', view: UserView } },
    { mode: 'cache-only' },
  );
  const userRef = observer.getSnapshot().data!.viewer;
  const Component = () => <span>{useView(UserView, userRef).name}</span>;
  const container = document.createElement('div');
  const root = createRoot(container, { onCaughtError: vi.fn() });
  try {
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <FateClient client={client}>
            <Component />
          </FateClient>
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toBe('Apple');
    await act(async () => {
      client.deleteRecord('User', '1');
      // Recreate only the name's coverage, leaving the selected id missing.
      client.write('User', { id: '1', name: 'Kiwi' }, new Set(['name']));
    });
    expect(container.textContent).toContain('Cache-only view');
    expect(fetchById).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});

test('subscribes to an uncached entity reached through a deferred ref', async () => {
  const request = Promise.withResolvers<Array<Partial<User>>>();
  const client = createClient({
    roots: {},
    transport: { fetchById: vi.fn(() => request.promise) },
    types: [{ fields: { author: { type: 'User' } }, type: 'Post' }, { type: 'User' }],
  });
  const UserView = view<User>()({ id: true, name: true });
  const PostView = view<Post>()({ author: defer(UserView), id: true });
  client.write(
    'Post',
    {
      __typename: 'Post',
      author: { __typename: 'User', id: 'user-1', name: 'Apple' },
      id: 'post-1',
    },
    new Set(['author.id', 'author.name', 'id']),
  );
  client.write(
    'Post',
    { __typename: 'Post', author: { __typename: 'User', id: 'user-2' }, id: 'post-2' },
    new Set(['author.id', 'id']),
  );
  const Component = ({ postRef }: { postRef: ViewRef<'Post'> }) => {
    const post = useView(PostView, postRef);
    return <span>{useView(UserView, post.author).name}</span>;
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  const render = (id: string) =>
    act(async () => {
      root.render(
        <FateClient client={client}>
          <Suspense fallback={null}>
            <Component postRef={client.ref<Post>('Post', id, PostView)} />
          </Suspense>
        </FateClient>,
      );
    });
  try {
    await render('post-1');
    expect(container.textContent).toBe('Apple');
    await render('post-2');
    expect(container.textContent).toBe('Apple');
    await act(async () => {
      request.resolve([{ __typename: 'User', id: 'user-2', name: 'Banana' }]);
    });
    expect(container.textContent).toBe('Banana');
    await act(async () => {
      client.write('User', { __typename: 'User', id: 'user-2', name: 'Kiwi' }, new Set(['name']));
    });
    expect(container.textContent).toBe('Kiwi');
  } finally {
    await act(async () => root.unmount());
  }
});
