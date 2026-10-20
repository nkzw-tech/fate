/** @vitest-environment happy-dom */

import {
  createClient,
  defer,
  getSelectionPlan,
  toEntityId,
  type FateClient as Client,
  type Transport,
  type ViewSelection,
  type ViewRef,
  view,
} from '@nkzw/fate';
import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import {
  computed,
  createApp,
  defineComponent,
  h,
  nextTick,
  ref,
  shallowRef,
  Suspense,
  type MaybeRefOrGetter,
} from 'vue';
import { FateClient, useViews } from '../index.ts';

type User = { __typename: 'User'; email: string; id: string; name: string };
type Post = { __typename: 'Post'; author: User; content: string; id: string };
const UserView = view<User>()({ name: true });
const PostView = view<Post>()({ author: { name: true }, content: true, id: true });
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
        author: { __typename: 'User', email: 'hidden', id, name: `Name ${id}` },
        content: `Post ${id}`,
        id,
      },
      new Set(['author.id', 'author.name', 'author.email', 'content', 'id']),
    );
  }
  return { client, fetchById };
};
const mount = <T>(
  client: MaybeRefOrGetter<Client<any, any>>,
  setup: () => T,
  render: (resource: T) => string = () => '',
) => {
  let resource!: T;
  const Component = defineComponent({
    setup() {
      resource = setup();
      return () => h('span', render(resource));
    },
  });
  const container = document.createElement('div');
  const app = createApp({
    render: () => h(FateClient, { client }, { default: () => h(Component) }),
  });
  app.mount(container);
  return { app, container, resource };
};

test('subscribes to selected nested data, preserves masking, and ignores unrelated writes', async () => {
  const { client, fetchById } = setup();
  const refs = ['2', '1'].map((id) => client.ref('Post', id, PostView));
  const tick = ref(0);
  const subscribe = vi.spyOn(client.store, 'subscribe');
  const rendered = vi.fn();
  const { app, container, resource } = mount(
    client,
    () =>
      useViews(PostView, () => {
        return tick.value >= 0 ? [...refs] : [];
      }),
    (posts) => {
      rendered();
      return posts.value.map((post) => `${post.content}:${post.author.name}`).join(',');
    },
  );
  try {
    await resource.ready();
    await nextTick();
    expect(container.textContent).toBe('Post 2:Name 2,Post 1:Name 1');
    expect(resource.value[0].author).not.toHaveProperty('email');
    expect(subscribe).toHaveBeenCalledTimes(4);
    const first = resource.value;
    tick.value++;
    await nextTick();
    expect(resource.value).toBe(first);
    expect(subscribe).toHaveBeenCalledTimes(4);
    const count = rendered.mock.calls.length;
    client.write('User', { email: 'another', id: '2' }, new Set(['email']));
    client.write('User', { id: '3', name: 'Unrelated' }, new Set(['name']));
    await nextTick();
    expect(rendered).toHaveBeenCalledTimes(count);
    client.write('User', { id: '2', name: 'Updated' }, new Set(['name']));
    expect(await resource.ready()).toBe(resource.value);
    await nextTick();
    expect(container.textContent).toBe('Post 2:Updated,Post 1:Name 1');
    expect(resource.value[1]).toBe(first[1]);
    expect(subscribe).toHaveBeenCalledTimes(4);
    expect(fetchById).not.toHaveBeenCalled();
    client.write(
      'Post',
      { author: { __typename: 'User', id: '3' }, id: '2' },
      new Set(['author.id']),
    );
    await resource.ready();
    client.write('User', { id: '3', name: 'New author' }, new Set(['name']));
    await resource.ready();
    expect(resource.value[0].author.name).toBe('New author');
  } finally {
    app.unmount();
  }
});

test('tracks reactive array replacements and in-place changes, with duplicate and nullish positions', async () => {
  const { client, fetchById } = setup();
  const first = client.ref('User', '1', UserView);
  const second = client.ref('User', '2', UserView);
  const refs = ref<Array<ViewRef<'User'> | null | undefined>>([
    first,
    null,
    first,
    undefined,
    second,
  ]);
  const original = client.store.subscribe.bind(client.store);
  const active = new Map<string, number>();
  vi.spyOn(client.store, 'subscribe').mockImplementation(
    (id: string, paths: ReadonlySet<string> | (() => void) | null, callback?: () => void) => {
      active.set(id, (active.get(id) ?? 0) + 1);
      const stop =
        typeof paths === 'function' ? original(id, paths) : original(id, paths, callback!);
      return () => {
        active.set(id, active.get(id)! - 1);
        stop();
      };
    },
  );
  const { app, resource } = mount(client, () => useViews(UserView, refs));
  try {
    await resource.ready();
    expect(resource.value.map((user) => user?.name ?? user)).toEqual([
      'Name 1',
      null,
      'Name 1',
      undefined,
      'Name 2',
    ]);
    expect(resource.value[0]).toBe(resource.value[2]);
    expect(active.get(toEntityId('User', '1'))).toBe(1);
    refs.value.reverse();
    await resource.ready();
    expect(resource.value.map((user) => user?.name ?? user)).toEqual([
      'Name 2',
      undefined,
      'Name 1',
      null,
      'Name 1',
    ]);
    refs.value.splice(1);
    await resource.ready();
    expect(active.get(toEntityId('User', '1'))).toBe(0);
    expect(resource.value).toHaveLength(1);
    refs.value = [];
    await resource.ready();
    expect(resource.value).toEqual([]);
    expect([...active.values()].every((count) => count === 0)).toBe(true);
    refs.value.push(first);
    await resource.ready();
    expect(resource.value[0]?.name).toBe('Name 1');
    resource.dispose();
    resource.dispose();
    const before = resource.value;
    refs.value = [second];
    client.write('User', { id: '1', name: 'Disposed' }, new Set(['name']));
    await nextTick();
    await resource.refresh();
    expect(resource.value).toBe(before);
    expect(fetchById).not.toHaveBeenCalled();
  } finally {
    app.unmount();
  }
  expect([...active.values()].every((count) => count === 0)).toBe(true);
});

test('keeps tuple positions, masking, nullable entries, and resource types', async () => {
  const { client } = setup();
  const first = client.ref('User', '1', UserView);
  const { app, resource } = mount(client, () => {
    const users = useViews(UserView, [first, null, undefined]);
    expectTypeOf(users.value[0].name).toEqualTypeOf<string>();
    expectTypeOf(users.value[1]).toEqualTypeOf<null>();
    expectTypeOf(users.value[2]).toEqualTypeOf<undefined>();
    expectTypeOf(users.value.length).toEqualTypeOf<3>();
    expectTypeOf(users.ready()).toEqualTypeOf<Promise<typeof users.value>>();
    const nullable = useViews(
      UserView,
      computed(() => [first as ViewRef<'User'> | null]),
    );
    expectTypeOf<Extract<(typeof nullable.value)[0], null>>().toEqualTypeOf<null>();
    const checkTypes = () => {
      // @ts-expect-error Unselected fields stay masked.
      expect(users.value[0].email).toBeUndefined();
      // @ts-expect-error References must match the view entity.
      useViews(UserView, [client.ref('Post', '1', PostView)]);
      // @ts-expect-error Result arrays are readonly.
      users.value.push(users.value[0]);
    };
    expect(checkTypes).toBeTypeOf('function');
    return users;
  });
  try {
    await resource.ready();
  } finally {
    app.unmount();
  }
});

test('retains per-ref argument bindings and combines selected paths on a shared entity', async () => {
  const Name = view<User>()(({ locale }: { locale: string }) => ({ name: { args: { locale } } }));
  const fetchById = vi.fn<Transport['fetchById']>(async (_type, ids, _select, args) =>
    ids.map((id) => ({ id, name: (args?.name as { locale: string } | undefined)?.locale })),
  );
  const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'User' }] });
  const en = Name({ locale: 'en' });
  const ja = Name({ locale: 'ja' });
  const first = client.ref('User', '1', en);
  const second = client.ref('User', '1', ja);
  await Promise.all([client.readView(Name, first), client.readView(Name, second)]);
  const subscribe = vi.spyOn(client.store, 'subscribe');
  const { app, resource } = mount(client, () => useViews(Name, [first, second, first]));
  try {
    await resource.ready();
    expect(resource.value.map((user) => user.name)).toEqual(['en', 'ja', 'en']);
    expect(subscribe).toHaveBeenCalledTimes(1);
    client.write(
      'User',
      { id: '1', name: 'Japanese' },
      new Set(['name']),
      getSelectionPlan(ja, null),
    );
    await resource.ready();
    client.write(
      'User',
      { id: '1', name: 'English' },
      new Set(['name']),
      getSelectionPlan(en, null),
    );
    await resource.ready();
    expect(resource.value.map((user) => user.name)).toEqual(['English', 'Japanese', 'English']);
    expect(subscribe).toHaveBeenCalledTimes(1);
    const before = resource.value;
    client.write(
      'User',
      { id: '1', name: 'French' },
      new Set(['name']),
      getSelectionPlan(Name({ locale: 'fr' }), null),
    );
    await nextTick();
    expect(resource.value).toBe(before);
  } finally {
    app.unmount();
  }
});

test('starts every missing read together without duplicating references', async () => {
  const pending = Promise.withResolvers<Array<Partial<User>>>();
  const fetchById = vi.fn<Transport['fetchById']>(() => pending.promise);
  const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'User' }] });
  const first = client.ref('User', '1', UserView);
  const second = client.ref('User', '2', UserView);
  const { app, resource } = mount(client, () => useViews(UserView, [first, second, first]));
  try {
    expect(resource.pending.value).toBe(true);
    expect(fetchById.mock.calls.flatMap(([, ids]) => ids)).toEqual(['1', '2']);
    const ready = resource.ready();
    expect(resource.refresh()).toBe(ready);
    pending.resolve([
      { id: '1', name: 'Apple' },
      { id: '2', name: 'Kiwi' },
    ]);
    const values = await ready;
    expect(resource.pending.value).toBe(false);
    expect(values).toBe(resource.value);
    expect(values.map((user) => user.name)).toEqual(['Apple', 'Kiwi', 'Apple']);
    expect(values[0]).toBe(values[2]);
    expect(fetchById).toHaveBeenCalledTimes(2);
  } finally {
    app.unmount();
  }
});

test.each([false, true])(
  'ignores removed and unmounted pending reads (rejection: %s)',
  async (rejection) => {
    const { client, fetchById } = setup();
    const first = Promise.withResolvers<Array<Partial<User>>>();
    fetchById.mockImplementation(() => first.promise);
    const refs = shallowRef([client.ref('User', 'missing', UserView)]);
    const subscribe = vi.spyOn(client.store, 'subscribe');
    const { app, resource } = mount(client, () => useViews(UserView, refs));
    const old = resource.ready();
    refs.value = [client.ref('User', '2', UserView)];
    await resource.ready();
    expect(resource.value[0].name).toBe('Name 2');
    const count = subscribe.mock.calls.length;
    first.resolve([{ id: 'missing', name: 'Stale' }]);
    await old;
    expect(resource.value[0].name).toBe('Name 2');
    expect(subscribe).toHaveBeenCalledTimes(count);
    const second = Promise.withResolvers<Array<Partial<User>>>();
    fetchById.mockImplementation(() => second.promise);
    refs.value = [client.ref('User', 'unmounted', UserView)];
    const unmounted = resource.ready().catch(() => undefined);
    app.unmount();
    const after = subscribe.mock.calls.length;
    if (rejection) {
      second.reject(new Error('Unmounted request failed'));
    } else {
      second.resolve([{ id: 'unmounted', name: 'Stale' }]);
    }
    await unmounted;
    expect(resource.value[0].name).toBe('Name 2');
    expect(subscribe).toHaveBeenCalledTimes(after);
    const requests = fetchById.mock.calls.length;
    await resource.refresh();
    expect(fetchById).toHaveBeenCalledTimes(requests);
  },
);

test('exposes read errors through the resource and allows a clean retry', async () => {
  const pending = Promise.withResolvers<Array<Partial<User>>>();
  const fetchById = vi.fn<Transport['fetchById']>(() => pending.promise);
  const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'User' }] });
  const refs = shallowRef([client.ref('User', '1', UserView)]);
  const { app, resource } = mount(client, () => useViews(UserView, refs));
  try {
    const error = new Error('Request failed');
    const rejected = expect(resource.ready()).rejects.toBe(error);
    pending.reject(error);
    await rejected;
    expect(resource.error.value).toBe(error);
    expect(resource.pending.value).toBe(false);
    fetchById.mockResolvedValue([{ id: '1', name: 'Recovered' }]);
    await resource.refresh();
    expect(resource.error.value).toBeNull();
    expect(resource.value[0].name).toBe('Recovered');
    const Wrong = view<User>()({ email: true });
    refs.value = [client.ref('User', '1', Wrong)];
    await expect(resource.ready()).rejects.toThrow('Invalid view reference');
    expect(resource.error.value).toBeInstanceOf(Error);
    expect(resource.pending.value).toBe(false);
  } finally {
    app.unmount();
  }
});

test('switches provider clients while old reads are pending', async () => {
  const { client: first, fetchById } = setup();
  const { client: second } = setup();
  const pending = Promise.withResolvers<Array<Partial<User>>>();
  fetchById.mockImplementation(() => pending.promise);
  second.write('User', { id: 'missing', name: 'New client' }, new Set(['name']));
  const source = shallowRef(first);
  const { app, resource } = mount(source, () =>
    useViews(UserView, [first.ref('User', 'missing', UserView)]),
  );
  const old = resource.ready();
  source.value = second;
  await resource.ready();
  expect(resource.value[0].name).toBe('New client');
  pending.resolve([{ id: 'missing', name: 'Stale client' }]);
  await old;
  expect(resource.value[0].name).toBe('New client');
  second.write('User', { id: 'missing', name: 'Active' }, new Set(['name']));
  await resource.ready();
  expect(resource.value[0].name).toBe('Active');
  app.unmount();
});

test('resolves nullable deferred refs with their bindings and follows owner changes', async () => {
  type Parent = User & { friend: User | null };
  const Name = view<User>()(({ locale }: { locale: string }) => ({ name: { args: { locale } } }));
  const ParentView = view<Parent>()({ friend: defer(Name({ locale: 'ja' })) });
  const { client } = setup();
  const plan = getSelectionPlan(Name({ locale: 'ja' }), null);
  for (const id of ['2', '3']) {
    client.write('User', { id, name: `Japanese ${id}` }, new Set(['name']), plan);
  }
  client.write(
    'User',
    { friend: { __typename: 'User', id: '2' }, id: '1' },
    new Set(['friend.id']),
  );
  const parent = (
    await client.readView<Parent, ViewSelection<typeof ParentView>, typeof ParentView>(
      ParentView,
      client.ref('User', '1', ParentView),
    )
  ).data;
  const { app, resource } = mount(client, () => {
    const users = useViews(Name, [parent.friend, parent.friend]);
    expectTypeOf<Extract<(typeof users.value)[0], null>>().toEqualTypeOf<null>();
    return users;
  });
  try {
    await resource.ready();
    expect(resource.value[0]?.name).toBe('Japanese 2');
    client.write(
      'User',
      { friend: { __typename: 'User', id: '3' }, id: '1' },
      new Set(['friend.id']),
    );
    await resource.ready();
    expect(resource.value[0]?.name).toBe('Japanese 3');
    client.write('User', { id: '3', name: 'Updated' }, new Set(['name']), plan);
    await resource.ready();
    expect(resource.value[0]?.name).toBe('Updated');
    client.write('User', { friend: null, id: '1' }, new Set(['friend.id']));
    await resource.ready();
    expect(resource.value).toEqual([null, null]);
    expect(await resource.refresh()).toBe(resource.value);
  } finally {
    app.unmount();
  }
});

test('awaiting ready in async setup participates in Vue Suspense', async () => {
  const pending = Promise.withResolvers<Array<Partial<User>>>();
  const client = createClient({
    roots: {},
    transport: { fetchById: () => pending.promise },
    types: [{ type: 'User' }],
  });
  const Component = defineComponent({
    async setup() {
      const users = useViews(UserView, [client.ref('User', '1', UserView)]);
      await users.ready();
      return () => h('span', users.value[0].name);
    },
  });
  const app = createApp({
    render: () =>
      h(
        FateClient,
        { client },
        {
          default: () =>
            h(Suspense, null, {
              default: () => h(Component),
              fallback: () => h('span', 'pending'),
            }),
        },
      ),
  });
  const container = document.createElement('div');
  app.mount(container);
  try {
    expect(container.textContent).toBe('pending');
    pending.resolve([{ id: '1', name: 'Ready' }]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await nextTick();
    expect(container.textContent).toBe('Ready');
  } finally {
    app.unmount();
  }
});

test('coalesces a burst of selected writes rather than rereading the array for every entity', async () => {
  const { client } = setup();
  const size = 256;
  const refs = Array.from({ length: size }, (_, index) => {
    const id = String(index);
    client.write('User', { id, name: `Before ${id}` }, new Set(['name']));
    return client.ref('User', id, UserView);
  });
  const { app, resource } = mount(client, () => useViews(UserView, refs));
  try {
    await resource.ready();
    const read = vi.spyOn(client, 'readView');
    for (let index = 0; index < size; index++) {
      client.write('User', { id: String(index), name: `After ${index}` }, new Set(['name']));
    }
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await resource.ready();
    expect(resource.value.map((user) => user.name)).toEqual(
      refs.map((_, index) => `After ${index}`),
    );
    expect(read.mock.calls.length).toBeLessThan(size * 12);
  } finally {
    app.unmount();
  }
});

test('captures the originating client for pending deferred reads', async () => {
  type Parent = User & { friend: User | null };
  const ParentView = view<Parent>()({ friend: defer(UserView) });
  const { client: first, fetchById } = setup();
  const { client: second, fetchById: secondFetch } = setup();
  const pending = Promise.withResolvers<Array<Partial<Parent>>>();
  fetchById.mockImplementation(() => pending.promise);
  first.write(
    'User',
    { friend: { __typename: 'User', id: 'missing' }, id: '1' },
    new Set(['friend.id']),
  );
  second.write(
    'User',
    { friend: { __typename: 'User', id: '3', name: 'Name 3' }, id: '1' },
    new Set(['friend.id', 'friend.name']),
  );
  const parent = (
    await first.readView<Parent, ViewSelection<typeof ParentView>, typeof ParentView>(
      ParentView,
      first.ref('User', '1', ParentView),
    )
  ).data;
  const source = shallowRef(first);
  const { app, resource } = mount(source, () => useViews(UserView, [parent.friend]));
  try {
    const old = resource.ready();
    expect(resource.pending.value).toBe(true);
    source.value = second;
    await resource.ready();
    expect(resource.value[0]?.name).toBe('Name 3');
    pending.resolve([
      { friend: { __typename: 'User', email: 'hidden', id: 'missing', name: 'Stale' }, id: '1' },
    ]);
    await old;
    expect(resource.value[0]?.name).toBe('Name 3');
    expect(secondFetch).not.toHaveBeenCalled();
  } finally {
    app.unmount();
  }
});

test('rechecks early results after every entry loads without quadratic subscription work', async () => {
  const size = 128;
  const responses = Array.from({ length: size }, () =>
    Promise.withResolvers<Array<Partial<User>>>(),
  );
  const client = createClient({
    roots: {},
    transport: { fetchById: (_type, ids) => responses[Number(ids[0])].promise },
    types: [{ type: 'User' }],
  });
  const refs = responses.map((_, index) => client.ref('User', String(index), UserView));
  const subscribe = vi.spyOn(client.store, 'subscribe');
  const read = vi.spyOn(client, 'readView');
  const { app, resource } = mount(client, () => useViews(UserView, refs));
  try {
    const ready = resource.ready();
    responses[0].resolve([{ id: '0', name: 'Old result' }]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    client.write('User', { id: '0', name: 'Latest result' }, new Set(['name']));
    for (let index = 1; index < size; index++) {
      responses[index].resolve([{ id: String(index), name: `Result ${index}` }]);
    }
    await ready;
    expect(resource.value[0].name).toBe('Latest result');
    expect(resource.value).toHaveLength(size);
    expect(subscribe.mock.calls.length).toBe(size);
    expect(read.mock.calls.length).toBeLessThan(size * 12);
  } finally {
    app.unmount();
  }
});
