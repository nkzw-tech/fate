import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { clientRoot, clientValueRoot } from '../root.ts';
import { view } from '../view.ts';

test('publishes new value-query results by identity without inspecting their properties', async () => {
  const propertyRead = vi.fn(() => 'same');
  const value = () => Object.defineProperty({}, 'content', { enumerable: true, get: propertyRead });
  const first = value();
  const second = value();
  const fetchQuery = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const client = createClient({
    roots: { value: clientValueRoot<object>() },
    transport: { fetchById: vi.fn(), fetchQuery },
    types: [],
  });
  const request = { value: { value: true as const } };
  await client.request(request);
  const observer = client.observeRequest(request);
  const initial = observer.getSnapshot();
  expect(initial.data?.value).toBe(first);
  await client.request(request, { mode: 'network-only' });
  const updated = observer.getSnapshot();
  expect(propertyRead).not.toHaveBeenCalled();
  expect(updated.data?.value).toBe(second);
  expect(updated).not.toBe(initial);
  expect(observer.getSnapshot()).toBe(updated);
});

test('keeps opaque cyclic values intact in cache-only snapshots', async () => {
  const value: { self?: unknown } = {};
  value.self = value;
  const client = createClient({
    roots: { value: clientValueRoot<object>() },
    transport: { fetchById: vi.fn(), fetchQuery: async () => value },
    types: [],
  });
  const request = { value: { value: true as const } };
  await client.request(request);
  const observer = client.observeRequest(request, { mode: 'cache-only' });
  const snapshot = observer.getSnapshot();
  expect(snapshot.data?.value).toBe(value);
  expect(observer.getSnapshot()).toBe(snapshot);
});

test('reuses request containers and only replaces the connection whose list changes', async () => {
  type User = { __typename: 'User'; id: string; name: string };
  const UserView = view<User>()({ id: true, name: true });
  const connection = { items: { node: UserView }, pagination: { hasNext: true as const } };
  const roots = {
    users: clientRoot<Array<User>, 'User'>('User'),
    viewer: clientRoot<User, 'User'>('User'),
  };
  const client = createClient<[typeof roots, Record<never, never>]>({
    roots,
    transport: {
      fetchById: async (_type, ids) => ids.map((id) => ({ id, name: 'Ada' })),
      fetchList: async () => ({
        items: [{ cursor: 'one', node: { id: '1', name: 'Ada' } }],
        pagination: { hasNext: false, hasPrevious: false },
      }),
    },
    types: [{ type: 'User' }],
  });
  const request = { users: { list: connection }, viewer: { ids: ['1'], view: UserView } };
  const first = await client.request(request);
  expect(await client.request(request)).toBe(first);
  for (const mode of ['cache-first', 'cache-only'] as const) {
    const observer = client.observeRequest(request, { mode });
    const listener = vi.fn();
    const unsubscribe = observer.subscribe(listener);
    await vi.waitFor(() => expect(observer.getSnapshot().isFetching).toBe(false));
    const snapshot = observer.getSnapshot();
    expect(observer.getSnapshot()).toBe(snapshot);
    listener.mockClear();
    client.write('User', { id: 'unrelated', name: 'Other' }, new Set(['id', 'name']));
    await Promise.resolve();
    expect(observer.getSnapshot()).toBe(snapshot);
    expect(listener).not.toHaveBeenCalled();
    const list = client.store.getListState('users')!;
    client.store.setList('users', {
      ...list,
      pagination: { hasPrevious: false, ...list.pagination, hasNext: !list.pagination?.hasNext },
    });
    await Promise.resolve();
    const updated = observer.getSnapshot();
    expect(updated.data?.users).not.toBe(snapshot.data?.users);
    expect(updated.data?.viewer).toBe(snapshot.data?.viewer);
    expect(observer.getSnapshot()).toBe(updated);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  }
});

test('does not recheck unrelated request observers after an entity write', async () => {
  type User = { __typename: 'User'; id: string; name: string };
  const UserView = view<User>()({ id: true, name: true });
  const client = createClient({
    roots: { user: clientRoot<User, 'User'>('User') },
    transport: { fetchById: async () => [] },
    types: [{ type: 'User' }],
  });
  const observers = Array.from({ length: 300 }, (_, index) => {
    const id = String(index);
    client.write('User', { id, name: id }, new Set(['id', 'name']));
    return client.observeRequest({ user: { id, view: UserView } }, { mode: 'cache-only' });
  });
  await Promise.resolve();
  const unsubscribe = observers.map((observer) => observer.subscribe(() => {}));
  for (const observer of observers) {
    expect(observer.getSnapshot().status).toBe('ready');
  }
  const coverage = vi.spyOn(
    client as unknown as { hasRequestData: () => boolean },
    'hasRequestData',
  );
  client.write('User', { id: 'unrelated', name: 'Other' }, new Set(['id', 'name']));
  await Promise.resolve();
  expect(coverage).not.toHaveBeenCalled();
  client.write('User', { id: '0', name: 'Updated' }, new Set(['id', 'name']));
  await Promise.resolve();
  expect(coverage).toHaveBeenCalledTimes(1);
  unsubscribe.forEach((dispose) => dispose());
});

test('tracks new root-list items when they arrive before their entity fields', async () => {
  type User = { __typename: 'User'; id: string; name: string };
  const UserView = view<User>()({ id: true, name: true });
  const client = createClient({
    roots: { users: clientRoot<Array<User>, 'User'>('User') },
    transport: {
      fetchById: async () => [],
      fetchList: async () => ({
        items: [],
        pagination: { hasNext: false, hasPrevious: false },
      }),
    },
    types: [{ type: 'User' }],
  });
  const request = { users: { list: { items: { node: UserView } } } };
  await client.request(request);
  const observer = client.observeRequest(request, { mode: 'cache-only' });
  const unsubscribe = observer.subscribe(() => {});
  expect(observer.getSnapshot().status).toBe('ready');
  client.store.setList('users', {
    ids: ['User:1'],
    pagination: { hasNext: false, hasPrevious: false },
  });
  await Promise.resolve();
  expect(observer.getSnapshot().status).toBe('missing');
  client.write('User', { id: '1', name: 'Ada' }, new Set(['id', 'name']));
  await Promise.resolve();
  expect(observer.getSnapshot().status).toBe('ready');
  unsubscribe();
});

test('moves query observers to the new root entity when its result changes', async () => {
  type User = { __typename: 'User'; id: string; name: string };
  const UserView = view<User>()({ id: true, name: true });
  const fetchQuery = vi
    .fn()
    .mockResolvedValueOnce({ id: '1', name: 'First' })
    .mockResolvedValueOnce({ id: '2', name: 'Second' });
  const client = createClient({
    roots: { viewer: clientRoot<User, 'User'>('User') },
    transport: { fetchById: async () => [], fetchQuery },
    types: [{ type: 'User' }],
  });
  const request = { viewer: { view: UserView } };
  await client.request(request);
  const observer = client.observeRequest(request, { mode: 'cache-only' });
  const unsubscribe = observer.subscribe(() => {});
  expect(observer.getSnapshot().data?.viewer).toMatchObject({ id: '1' });
  await client.request(request, { mode: 'network-only' });
  await Promise.resolve();
  expect(observer.getSnapshot().data?.viewer).toMatchObject({ id: '2' });
  const coverage = vi.spyOn(
    client as unknown as { hasRequestData: () => boolean },
    'hasRequestData',
  );
  client.write('User', { id: '1', name: 'Old' }, new Set(['id', 'name']));
  await Promise.resolve();
  expect(coverage).not.toHaveBeenCalled();
  client.write('User', { id: '2', name: 'New' }, new Set(['id', 'name']));
  await Promise.resolve();
  expect(coverage).toHaveBeenCalledTimes(1);
  unsubscribe();
});

test('cached child fields satisfy parent selections and notify observers when they arrive', async () => {
  type User = { __typename: 'User'; friend: User | null; id: string; name: string };
  const Parent = view<User>()({ friend: { name: true } });
  const fetchById = vi.fn(async () => []);
  const client = createClient({
    roots: { user: clientRoot<User, 'User'>('User') },
    transport: { fetchById },
    types: [{ fields: { friend: { type: 'User' } }, type: 'User' }],
  });
  client.write('User', { friend: { id: '2' }, id: '1' }, new Set(['friend.id']));
  const request = { user: { id: '1', view: Parent } };
  const observer = client.observeRequest(request, { mode: 'cache-only' });
  const listener = vi.fn();
  const dispose = observer.subscribe(listener);
  try {
    expect(observer.getSnapshot().status).toBe('missing');
    client.write('User', { id: '2', name: 'Ada' }, new Set(['name']));
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(observer.getSnapshot().status).toBe('ready');
    const { user } = await client.request(request);
    expect((await client.readView(Parent, user)).data).toMatchObject({ friend: { name: 'Ada' } });
    expect(fetchById).not.toHaveBeenCalled();
    listener.mockClear();
    client.write('User', { friend: null, id: '1' }, new Set(['friend']));
    await Promise.resolve();
    expect(observer.getSnapshot().status).toBe('ready');
    client.write('User', { id: '2', name: 'Detached' }, new Set(['name']));
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});

test('parent requests detect coverage removed from normalized children and fetch it again', async () => {
  type User = {
    __typename: 'User';
    characters: Array<{ __typename: 'Character'; color: number; unitId: number }>;
    friend: User;
    id: string;
  };
  const Parent = view<User>()({ friend: { characters: { color: true, unitId: true } } });
  const server = { friend: { characters: [{ color: 3, unitId: 99 }], id: '2' }, id: '1' };
  const fetchById = vi.fn(async () => [server]);
  const client = createClient({
    roots: { user: clientRoot<User, 'User'>('User') },
    transport: { fetchById },
    types: [
      { fields: { characters: { embedded: 'Character' }, friend: { type: 'User' } }, type: 'User' },
    ],
  });
  client.write('User', server, new Set(['friend.characters.color', 'friend.characters.unitId']));
  const request = { user: { id: '1', view: Parent } };
  const observer = client.observeRequest(request, { mode: 'cache-only' });
  const listener = vi.fn();
  const dispose = observer.subscribe(listener);
  try {
    expect(observer.getSnapshot().status).toBe('ready');
    client.write('User', { characters: [{ color: 2 }], id: '2' }, new Set(['characters.color']));
    await Promise.resolve();
    expect(observer.getSnapshot().status).toBe('missing');
    expect(listener).toHaveBeenCalledTimes(1);
    const { user } = await client.request(request);
    expect(fetchById).toHaveBeenCalledTimes(1);
    expect((await client.readView(Parent, user)).data).toMatchObject({
      friend: { characters: [{ color: 3, unitId: 99 }] },
    });
    expect(observer.getSnapshot().status).toBe('ready');
  } finally {
    dispose();
  }
});

test('unchanged cached requests reuse completeness checks until the store changes', async () => {
  type User = { __typename: 'User'; id: string; name: string };
  const Name = view<User>()({ name: true });
  const fetchById = vi.fn(async () => [{ id: '1', name: 'Ada' }]);
  const client = createClient({
    roots: { user: clientRoot<User, 'User'>('User') },
    transport: { fetchById },
    types: [{ type: 'User' }],
  });
  const request = { user: { id: '1', view: Name } };
  await client.request(request);
  await client.request(request);
  const coverage = vi.spyOn(client.store, 'hasCoverage');
  await client.request(request);
  await client.request(request);
  expect(coverage).not.toHaveBeenCalled();
  client.write('User', { id: '1', name: 'Updated' }, new Set(['name']));
  await client.request(request);
  expect(coverage).toHaveBeenCalled();
  expect(fetchById).toHaveBeenCalledTimes(1);
});
