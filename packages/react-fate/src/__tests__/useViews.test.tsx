/** @vitest-environment happy-dom */

import {
  createClient,
  defer,
  getSelectionPlan,
  toEntityId,
  type Transport,
  type ViewRef,
  view,
} from '@nkzw/fate';
import { act, Component as ReactComponent, StrictMode, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { FateClient, useView, useViews } from '../index.tsx';

// @ts-expect-error React test environment.
global.IS_REACT_ACT_ENVIRONMENT = true;

type User = { __typename: 'User'; email: string; id: string; name: string };
type Post = { __typename: 'Post'; author: User; content: string; id: string };
const PostView = view<Post>()({ author: { name: true }, content: true, id: true });
const UserView = view<User>()({ name: true });
const setup = () => {
  const fetchById = vi.fn<Transport['fetchById']>(async () => []);
  const client = createClient({
    roots: {},
    transport: { fetchById },
    types: [
      { fields: { author: { type: 'User' } }, type: 'Post' },
      { fields: { friend: { type: 'User' } }, type: 'User' },
    ],
  });
  for (const id of ['1', '2', '3']) {
    client.write(
      'Post',
      {
        author: { __typename: 'User', email: `${id}@example.com`, id, name: `Name ${id}` },
        content: `Post ${id}`,
        id,
      },
      new Set(['author.email', 'author.id', 'author.name', 'content', 'id']),
    );
  }
  return { client, fetchById };
};

class ErrorBoundary extends ReactComponent<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error ? <span>{this.state.error.message}</span> : this.props.children;
  }
}

test('reads masked data in order and updates selected nested fields without replacing refs', async () => {
  const { client, fetchById } = setup();
  const refs = ['2', '1'].map((id) => client.ref('Post', id, PostView));
  const subscribe = vi.spyOn(client.store, 'subscribe');
  const renders = vi.fn();
  const container = document.createElement('div');
  const root = createRoot(container);
  const Component = () => {
    const posts = useViews(PostView, [...refs]);
    renders(posts);
    expect(posts[0].author).not.toHaveProperty('email');
    return posts.map((post) => `${post.content}:${post.author.name}`).join(',');
  };
  const render = () =>
    act(async () =>
      root.render(
        <FateClient client={client}>
          <Component />
        </FateClient>,
      ),
    );
  try {
    await render();
    expect(container.textContent).toBe('Post 2:Name 2,Post 1:Name 1');
    expect(subscribe).toHaveBeenCalledTimes(4);
    const first = renders.mock.lastCall![0];
    await render();
    expect(renders.mock.lastCall![0]).toBe(first);
    expect(subscribe).toHaveBeenCalledTimes(4);
    const count = renders.mock.calls.length;
    await act(async () => {
      client.write('User', { email: 'changed', id: '2' }, new Set(['email']));
      client.write('User', { id: '3', name: 'Unrelated' }, new Set(['name']));
    });
    expect(renders).toHaveBeenCalledTimes(count);
    await act(async () => {
      client.write('User', { id: '2', name: 'Updated' }, new Set(['name']));
    });
    expect(container.textContent).toBe('Post 2:Updated,Post 1:Name 1');
    expect(renders.mock.lastCall![0]).not.toBe(first);
    expect(renders.mock.lastCall![0][1]).toBe(first[1]);
    expect(subscribe).toHaveBeenCalledTimes(4);
    expect(fetchById).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});

test('supports changing membership, duplicates, nulls, undefined, and empty arrays with cleanup', async () => {
  const { client, fetchById } = setup();
  const originalSubscribe = client.store.subscribe.bind(client.store);
  const active = new Map<string, number>();
  vi.spyOn(client.store, 'subscribe').mockImplementation(
    (id: string, paths: ReadonlySet<string> | (() => void) | null, callback?: () => void) => {
      active.set(id, (active.get(id) ?? 0) + 1);
      const unsubscribe =
        typeof paths === 'function'
          ? originalSubscribe(id, paths)
          : originalSubscribe(id, paths, callback!);
      return () => {
        active.set(id, active.get(id)! - 1);
        unsubscribe();
      };
    },
  );
  const first = client.ref('User', '1', UserView);
  const second = client.ref('User', '2', UserView);
  const renders = vi.fn();
  const Component = ({ refs }: { refs: ReadonlyArray<ViewRef<'User'> | null | undefined> }) => {
    const users = useViews(UserView, refs);
    renders(users);
    return users
      .map((user) => (user === null ? 'null' : user === undefined ? 'undefined' : user.name))
      .join(',');
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  const render = (refs: ReadonlyArray<ViewRef<'User'> | null | undefined>) =>
    act(async () =>
      root.render(
        <StrictMode>
          <FateClient client={client}>
            <Component refs={refs} />
          </FateClient>
        </StrictMode>,
      ),
    );
  try {
    await render([first, null, first, undefined, second]);
    expect(container.textContent).toBe('Name 1,null,Name 1,undefined,Name 2');
    expect(renders.mock.lastCall![0][0]).toBe(renders.mock.lastCall![0][2]);
    expect(active.get(toEntityId('User', '1'))).toBe(1);
    expect(active.get(toEntityId('User', '2'))).toBe(1);
    await render([second, first]);
    expect(container.textContent).toBe('Name 2,Name 1');
    await render([second]);
    expect(active.get(toEntityId('User', '1'))).toBe(0);
    const count = renders.mock.calls.length;
    await act(async () => client.write('User', { id: '1', name: 'Removed' }, new Set(['name'])));
    expect(renders).toHaveBeenCalledTimes(count);
    await render([]);
    expect(container.textContent).toBe('');
    expect([...active.values()].every((count) => count === 0)).toBe(true);
    expect(fetchById).not.toHaveBeenCalled();
    await render([first]);
    expect(container.textContent).toBe('Removed');
  } finally {
    await act(async () => root.unmount());
  }
  expect([...active.values()].every((count) => count === 0)).toBe(true);
});

test('preserves tuple types, nullable positions, and masking', async () => {
  const { client } = setup();
  const ref = client.ref('User', '1', UserView);
  function Component() {
    const users = useViews(UserView, [ref, null, undefined]);
    expectTypeOf(users[0].name).toEqualTypeOf<string>();
    expectTypeOf(users[1]).toEqualTypeOf<null>();
    expectTypeOf(users[2]).toEqualTypeOf<undefined>();
    expectTypeOf(users.length).toEqualTypeOf<3>();
    const nullable = useViews(UserView, [ref as ViewRef<'User'> | null]);
    expectTypeOf(nullable[0]).toExtend<{ name: string } | null>();
    expectTypeOf<Extract<(typeof nullable)[0], null>>().toEqualTypeOf<null>();
    const CheckTypes = () => {
      // @ts-expect-error Only selected fields are available.
      expect(users[0].email).toBeUndefined();
      // @ts-expect-error References must match the view entity.
      useViews(UserView, [client.ref('Post', '1', PostView)]);
      // @ts-expect-error Result arrays are readonly.
      users.push(users[0]);
    };
    expect(CheckTypes).toBeTypeOf('function');
    return users[0].name;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () =>
      root.render(
        <FateClient client={client}>
          <Component />
        </FateClient>,
      ),
    );
  } finally {
    await act(async () => root.unmount());
  }
});

test('retains distinct parameter bindings on the same entity and unions subscriptions', async () => {
  const Name = view<User>()(({ locale }: { locale: string }) => ({ name: { args: { locale } } }));
  const client = createClient({
    roots: {},
    transport: {
      fetchById: vi.fn(async (_type, ids, _paths, args) =>
        ids.map((id: string | number) => ({ id, name: args?.name?.locale })),
      ),
    },
    types: [{ type: 'User' }],
  });
  const en = Name({ locale: 'en' });
  const ja = Name({ locale: 'ja' });
  const first = client.ref('User', '1', en);
  const second = client.ref('User', '1', ja);
  await Promise.all([client.readView(Name, first), client.readView(Name, second)]);
  const subscribe = vi.spyOn(client.store, 'subscribe');
  const renders = vi.fn();
  const Component = () => {
    const names = useViews(Name, [first, second, first]);
    renders(names);
    return names.map((name) => name.name).join(',');
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <FateClient client={client}>
          <Component />
        </FateClient>,
      ),
    );
    expect(container.textContent).toBe('en,ja,en');
    expect(subscribe).toHaveBeenCalledTimes(1);
    await act(async () =>
      client.write(
        'User',
        { id: '1', name: 'Japanese' },
        new Set(['name']),
        getSelectionPlan(ja, null),
      ),
    );
    expect(container.textContent).toBe('en,Japanese,en');
    await act(async () =>
      client.write(
        'User',
        { id: '1', name: 'English' },
        new Set(['name']),
        getSelectionPlan(en, null),
      ),
    );
    expect(container.textContent).toBe('English,Japanese,English');
    expect(subscribe).toHaveBeenCalledTimes(1);
    const count = renders.mock.calls.length;
    await act(async () =>
      client.write(
        'User',
        { id: '1', name: 'French' },
        new Set(['name']),
        getSelectionPlan(Name({ locale: 'fr' }), null),
      ),
    );
    expect(renders).toHaveBeenCalledTimes(count);
  } finally {
    await act(async () => root.unmount());
  }
});

test('starts all missing reads before suspending and deduplicates refs', async () => {
  const pending = Promise.withResolvers<Array<Partial<User>>>();
  const fetchById = vi.fn<Transport['fetchById']>(() => pending.promise);
  const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'User' }] });
  const first = client.ref('User', '1', UserView);
  const second = client.ref('User', '2', UserView);
  const Component = () =>
    useViews(UserView, [first, second, first])
      .map((user) => user.name)
      .join(',');
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <StrictMode>
          <FateClient client={client}>
            <Suspense fallback="pending">
              <Component />
            </Suspense>
          </FateClient>
        </StrictMode>,
      ),
    );
    expect(container.textContent).toBe('pending');
    expect(fetchById).toHaveBeenCalledTimes(2);
    expect(fetchById.mock.calls.flatMap(([, ids]) => ids)).toEqual(['1', '2']);
    await act(async () =>
      pending.resolve([
        { id: '1', name: 'Apple' },
        { id: '2', name: 'Kiwi' },
      ]),
    );
    expect(container.textContent).toBe('Apple,Kiwi,Apple');
    expect(fetchById).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
  }
});

test.each([false, true])(
  'ignores removed or unmounted pending reads (rejection: %s)',
  async (rejection) => {
    const { client, fetchById } = setup();
    const pending = Promise.withResolvers<Array<Partial<User>>>();
    fetchById.mockImplementation(() => pending.promise);
    const subscribe = vi.spyOn(client.store, 'subscribe');
    const Component = ({ ids }: { ids: Array<string> }) =>
      useViews(
        UserView,
        ids.map((id) => client.ref('User', id, UserView)),
      )
        .map((user) => user.name)
        .join(',');
    const container = document.createElement('div');
    const root = createRoot(container);
    const render = (ids: Array<string>) =>
      act(async () =>
        root.render(
          <FateClient client={client}>
            <Suspense fallback="pending">
              <Component ids={ids} />
            </Suspense>
          </FateClient>,
        ),
      );
    await render(['1']);
    await render(['missing']);
    expect(container.textContent).toBe('pending');
    await render(['2']);
    expect(container.textContent).toBe('Name 2');
    const count = subscribe.mock.calls.length;
    await act(async () => pending.resolve([{ id: 'missing', name: 'Stale' }]));
    expect(container.textContent).toBe('Name 2');
    expect(subscribe).toHaveBeenCalledTimes(count);
    const unmounted = Promise.withResolvers<Array<Partial<User>>>();
    fetchById.mockImplementation(() => unmounted.promise);
    await render(['another']);
    await act(async () => root.unmount());
    const afterUnmount = subscribe.mock.calls.length;
    await act(async () => {
      if (rejection) {
        unmounted.reject(new Error('Unmounted request failed'));
      } else {
        unmounted.resolve([{ id: 'another', name: 'Stale' }]);
      }
    });
    expect(subscribe).toHaveBeenCalledTimes(afterUnmount);
  },
);

test('passes request errors to the nearest error boundary', async () => {
  const pending = Promise.withResolvers<Array<Partial<User>>>();
  const client = createClient({
    roots: {},
    transport: { fetchById: () => pending.promise },
    types: [{ type: 'User' }],
  });
  const Component = () => useViews(UserView, [client.ref('User', '1', UserView)])[0].name;
  const container = document.createElement('div');
  const root = createRoot(container, { onCaughtError: vi.fn() });
  try {
    await act(async () =>
      root.render(
        <ErrorBoundary>
          <FateClient client={client}>
            <Suspense fallback="pending">
              <Component />
            </Suspense>
          </FateClient>
        </ErrorBoundary>,
      ),
    );
    await act(async () => pending.reject(new Error('Request failed')));
    expect(container.textContent).toBe('Request failed');
  } finally {
    await act(async () => root.unmount());
  }
});

test('reads deferred refs and follows changes to their owning selection', async () => {
  type Parent = User & { friend: User | null };
  const ParentView = view<Parent>()({ friend: defer(UserView) });
  const { client } = setup();
  client.write(
    'User',
    { friend: { __typename: 'User', id: '2' }, id: '1' },
    new Set(['friend.id']),
  );
  const parentRef = client.ref('User', '1', ParentView);
  const Component = () => {
    const parent = useView(ParentView, parentRef);
    const users = useViews(UserView, [parent.friend, parent.friend]);
    expectTypeOf(users[0]).toExtend<{ name: string } | null>();
    expectTypeOf<Extract<(typeof users)[0], null>>().toEqualTypeOf<null>();
    return users.map((user) => user?.name ?? 'none').join(',');
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <FateClient client={client}>
          <Component />
        </FateClient>,
      ),
    );
    expect(container.textContent).toBe('Name 2,Name 2');
    await act(async () => client.write('User', { id: '2', name: 'Updated' }, new Set(['name'])));
    expect(container.textContent).toBe('Updated,Updated');
    await act(async () =>
      client.write(
        'User',
        { friend: { __typename: 'User', id: '3' }, id: '1' },
        new Set(['friend.id']),
      ),
    );
    expect(container.textContent).toBe('Name 3,Name 3');
    await act(async () => client.write('User', { friend: null, id: '1' }, new Set(['friend.id'])));
    expect(container.textContent).toBe('none,none');
  } finally {
    await act(async () => root.unmount());
  }
});

test('updates subscriptions when nested entity references change', async () => {
  const { client } = setup();
  const ref = client.ref('Post', '1', PostView);
  const Component = () => useViews(PostView, [ref])[0].author.name;
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <FateClient client={client}>
          <Component />
        </FateClient>,
      ),
    );
    await act(async () =>
      client.write(
        'Post',
        { author: { __typename: 'User', id: '2' }, id: '1' },
        new Set(['author.id']),
      ),
    );
    expect(container.textContent).toBe('Name 2');
    await act(async () => client.write('User', { id: '2', name: 'Changed' }, new Set(['name'])));
    expect(container.textContent).toBe('Changed');
  } finally {
    await act(async () => root.unmount());
  }
});

test('reports synchronous ref errors while handling other entries that are still fetching', async () => {
  const pending = Promise.withResolvers<Array<Partial<User>>>();
  const client = createClient({
    roots: {},
    transport: { fetchById: () => pending.promise },
    types: [{ type: 'User' }],
  });
  const OtherView = view<User>()({ email: true });
  const first = client.ref('User', '1', UserView);
  const invalid = client.ref('User', '2', OtherView);
  const Component = () =>
    useViews(UserView, [first, invalid])
      .map((user) => user.name)
      .join(',');
  const container = document.createElement('div');
  const root = createRoot(container, { onCaughtError: vi.fn() });
  try {
    await act(async () =>
      root.render(
        <ErrorBoundary>
          <FateClient client={client}>
            <Suspense fallback="pending">
              <Component />
            </Suspense>
          </FateClient>
        </ErrorBoundary>,
      ),
    );
    expect(container.textContent).toContain('Invalid view reference');
    await act(async () => pending.reject(new Error('Another entry failed')));
    expect(container.textContent).toContain('Invalid view reference');
  } finally {
    await act(async () => root.unmount());
  }
});

test('coalesces a burst of entity updates instead of rereading the array for every write', async () => {
  const { client } = setup();
  const size = 256;
  const refs = Array.from({ length: size }, (_, index) => {
    const id = String(index);
    client.write('User', { id, name: `Before ${id}` }, new Set(['name']));
    return client.ref('User', id, UserView);
  });
  const Component = () =>
    useViews(UserView, refs)
      .map((user) => user.name)
      .join(',');
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <FateClient client={client}>
          <Component />
        </FateClient>,
      ),
    );
    const read = vi.spyOn(client, 'readViewForRender');
    await act(async () => {
      for (let index = 0; index < size; index++) {
        client.write('User', { id: String(index), name: `After ${index}` }, new Set(['name']));
      }
    });
    expect(container.textContent).toBe(refs.map((_, index) => `After ${index}`).join(','));
    expect(read.mock.calls.length).toBeLessThan(size * 12);
  } finally {
    await act(async () => root.unmount());
  }
});

test('switches clients and view selections without retaining stale data or subscriptions', async () => {
  const { client: first } = setup();
  const { client: second } = setup();
  second.write('User', { id: '1', name: 'Second client' }, new Set(['name']));
  const AlternateView = view<User>()({ name: true });
  const ref = first.ref('User', '1', { ...UserView, ...AlternateView });
  const renders = vi.fn();
  const Component = ({ alternate }: { alternate: boolean }) => {
    const users = useViews(alternate ? AlternateView : UserView, [ref]);
    renders(users);
    return users[0].name;
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  const render = (client: typeof first, alternate = false) =>
    act(async () =>
      root.render(
        <FateClient client={client}>
          <Component alternate={alternate} />
        </FateClient>,
      ),
    );
  try {
    await render(first);
    expect(container.textContent).toBe('Name 1');
    await render(first, true);
    expect(container.textContent).toBe('Name 1');
    await render(second, true);
    expect(container.textContent).toBe('Second client');
    const count = renders.mock.calls.length;
    await act(async () =>
      first.write('User', { id: '1', name: 'Stale client' }, new Set(['name'])),
    );
    expect(renders).toHaveBeenCalledTimes(count);
    await act(async () =>
      second.write('User', { id: '1', name: 'Active client' }, new Set(['name'])),
    );
    expect(container.textContent).toBe('Active client');
  } finally {
    await act(async () => root.unmount());
  }
});

test('keeps Suspense stable when rerendered before the initial reads finish', async () => {
  const first = Promise.withResolvers<Array<Partial<User>>>();
  const second = Promise.withResolvers<Array<Partial<User>>>();
  const fetchById = vi.fn<Transport['fetchById']>((_type, ids) =>
    ids[0] === '1' ? first.promise : second.promise,
  );
  const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'User' }] });
  const refs = ['1', '2'].map((id) => client.ref('User', id, UserView));
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const Component = ({ tick }: { tick: number }) =>
    `${tick}:${useViews(UserView, [...refs])
      .map((user) => user.name)
      .join(',')}`;
  const container = document.createElement('div');
  const root = createRoot(container);
  const render = (tick: number) =>
    act(async () =>
      root.render(
        <FateClient client={client}>
          <Suspense fallback="pending">
            <Component tick={tick} />
          </Suspense>
        </FateClient>,
      ),
    );
  try {
    await render(1);
    await render(2);
    await render(3);
    expect(container.textContent).toBe('pending');
    expect(fetchById).toHaveBeenCalledTimes(2);
    await act(async () => first.resolve([{ id: '1', name: 'Apple' }]));
    await render(4);
    expect(container.textContent).toBe('pending');
    await act(async () => second.resolve([{ id: '2', name: 'Kiwi' }]));
    expect(container.textContent).toBe('4:Apple,Kiwi');
    expect(errors).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    errors.mockRestore();
  }
});

test('recomputes aggregate filtering when nested membership changes and the outer refs stay identical', async () => {
  type Game = { __typename: 'Game'; id: string; users: Array<User> };
  const GameView = view<Game>()({ id: true, users: { id: true } });
  const client = createClient({
    roots: {},
    transport: { fetchById: vi.fn(async () => []) },
    types: [{ fields: { users: { listOf: 'User' } }, type: 'Game' }, { type: 'User' }],
  });
  const paths = new Set(['id', 'users.id']);
  client.write('Game', { id: 'game', users: [{ __typename: 'User', id: 'Maxima' }] }, paths);
  const refs = [client.ref('Game', 'game', GameView)];
  const Component = () =>
    String(
      useViews(GameView, refs).filter((game) => !game.users.some((user) => user.id === 'Sam'))
        .length,
    );
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <FateClient client={client}>
          <Component />
        </FateClient>,
      ),
    );
    expect(container.textContent).toBe('1');
    await act(async () =>
      client.write(
        'Game',
        {
          id: 'game',
          users: [
            { __typename: 'User', id: 'Maxima' },
            { __typename: 'User', id: 'Sam' },
          ],
        },
        paths,
      ),
    );
    expect(container.textContent).toBe('0');
  } finally {
    await act(async () => root.unmount());
  }
});
