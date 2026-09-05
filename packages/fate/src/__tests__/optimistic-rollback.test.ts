import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { mutation } from '../mutation.ts';
import { getNodeRefId, type NodeRef } from '../node-ref.ts';
import { toEntityId } from '../ref.ts';
import { clientRoot } from '../root.ts';
import type { FateRoots } from '../types.ts';
import { view } from '../view.ts';

type User = { __typename: 'User'; id: string; name: string; score: number };
const initial: User = { __typename: 'User', id: '1', name: 'Initial', score: 0 };
const userId = toEntityId('User', '1');
const UserView = view<User>()({ id: true, name: true, score: true });

const setup = () => {
  const first = Promise.withResolvers<Partial<User>>();
  const second = Promise.withResolvers<Partial<User>>();
  const mutations = { edit: mutation<User, { id: string }, Partial<User>>('User') };
  const client = createClient<[FateRoots, typeof mutations]>({
    mutations,
    roots: {},
    transport: {
      fetchById: async () => [],
      mutate: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    },
    types: [{ type: 'User' }],
  });
  client.write('User', initial, new Set(['id', 'name', 'score']));
  return { client, first, second };
};

test('settling an optimistic update is idempotent and releases its state', () => {
  const { client } = setup();
  const settle = client.store.optimisticUpdate(() =>
    client.write('User', { id: '1', name: 'Pending' }, new Set(['id', 'name'])),
  );
  expect(() => client.dehydrate()).toThrow(/optimistic updates are active/);
  settle();
  expect(client.store.read(userId)?.name).toBe('Initial');
  const commit = vi.fn();
  settle(commit);
  expect(commit).not.toHaveBeenCalled();
  expect(() => client.dehydrate()).not.toThrow();
});

test('settling an optimistic update resumes deferred garbage collection', () => {
  const { client } = setup();
  const settle = client.store.optimisticUpdate(() =>
    client.write('User', { id: '1', name: 'Pending' }, new Set(['id', 'name'])),
  );
  client.gc();
  expect(client.store.read(userId)?.name).toBe('Pending');
  settle();
  expect(client.store.read(userId)).toBeUndefined();
});

for (const sameField of [false, true]) {
  test(`failed optimistic edits preserve successful concurrent ${sameField ? 'overlapping' : 'independent'} edits`, async () => {
    const { client, first, second } = setup();
    const a = client.mutations
      .edit({ input: { id: '1' }, optimistic: { name: 'Pending A' } })
      .catch(() => undefined);
    const b = client.mutations.edit({
      input: { id: '1' },
      optimistic: sameField ? { name: 'Pending B' } : { score: 1 },
    });
    const successful = sameField ? { name: 'Saved B' } : { score: 2 };
    second.resolve({ id: '1', ...successful });
    await b;
    first.reject(new Error('A failed'));
    await a;
    expect(client.store.read(userId)).toMatchObject({ ...initial, ...successful });
    await expect(
      client.readView(UserView, client.ref('User', '1', UserView)),
    ).resolves.toMatchObject({ data: { id: '1', name: 'Initial', score: 0, ...successful } });
  });
}

for (const failFirst of [false, true]) {
  test(`overlapping optimistic failures unwind when ${failFirst ? 'older' : 'newer'} mutation fails first`, async () => {
    const { client, first, second } = setup();
    const a = client.mutations
      .edit({ input: { id: '1' }, optimistic: { name: 'Pending A' } })
      .catch(() => undefined);
    const b = client.mutations
      .edit({ input: { id: '1' }, optimistic: { name: 'Pending B' } })
      .catch(() => undefined);
    (failFirst ? first : second).reject(new Error('failed'));
    await (failFirst ? a : b);
    expect(client.store.read(userId)).toMatchObject({
      name: failFirst ? 'Pending B' : 'Pending A',
    });
    (failFirst ? second : first).reject(new Error('also failed'));
    await (failFirst ? b : a);
    expect(client.store.read(userId)).toMatchObject(initial);
  });
}

test('rollback preserves authoritative writes received while an optimistic mutation is pending', async () => {
  const { client, first } = setup();
  const pending = client.mutations
    .edit({ input: { id: '1' }, optimistic: { name: 'Pending' } })
    .catch(() => undefined);
  client.write('User', { id: '1', name: 'Live name', score: 3 }, new Set(['id', 'name', 'score']));
  first.reject(new Error('failed'));
  await pending;
  expect(client.store.read(userId)).toMatchObject({ name: 'Live name', score: 3 });
});

for (const order of [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]) {
  test(`three overlapping edits preserve live data when failures arrive in order ${order.join(', ')}`, async () => {
    const responses = order.map(() => Promise.withResolvers<Partial<User>>());
    const edits = [{ name: 'A', score: 1 }, { name: 'B' }, { score: 3 }];
    const mutations = { edit: mutation<User, { id: string }, Partial<User>>('User') };
    const mutate = vi.fn();
    for (const response of responses) {
      mutate.mockReturnValueOnce(response.promise);
    }
    const client = createClient<[FateRoots, typeof mutations]>({
      mutations,
      roots: {},
      transport: {
        fetchById: async () => [],
        mutate,
      },
      types: [{ type: 'User' }],
    });
    client.write('User', initial, new Set(['id', 'name', 'score']));
    const pending = edits.map((optimistic) =>
      client.mutations.edit({ input: { id: '1' }, optimistic }).catch(() => undefined),
    );
    const live = { id: '1', name: 'Live', score: 8 };
    client.write('User', live, new Set(['id', 'name', 'score']));
    const failed = new Set<number>();
    for (const index of order) {
      responses[index].reject(new Error('failed'));
      await pending[index];
      failed.add(index);
      expect(client.store.read(userId)).toMatchObject({
        name: !failed.has(1) ? 'B' : !failed.has(0) ? 'A' : 'Live',
        score: !failed.has(2) ? 3 : !failed.has(0) ? 1 : 8,
      });
    }
    expect(() => client.dehydrate()).not.toThrow();
  });
}

test('rollback preserves a successful concurrent list insertion', async () => {
  const first = Promise.withResolvers<User>();
  const second = Promise.withResolvers<User>();
  const mutations = { create: mutation<User, { name: string }, User>('User') };
  const client = createClient<[FateRoots, typeof mutations]>({
    mutations,
    roots: { users: clientRoot('User') },
    transport: {
      fetchById: async () => [],
      fetchList: async () => ({
        items: [{ cursor: 'c1', node: initial }],
        pagination: { hasNext: false, hasPrevious: false },
      }),
      mutate: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    },
    types: [{ type: 'User' }],
  });
  const request = { users: { list: { items: { cursor: true, node: UserView } } } };
  await client.request(request);
  const a = client.mutations
    .create({ input: { name: 'A' }, optimistic: { id: 'temp-a', name: 'A', score: 0 } })
    .catch(() => undefined);
  const b = client.mutations.create({
    input: { name: 'B' },
    optimistic: { id: 'temp-b', name: 'B', score: 0 },
  });
  second.resolve({ __typename: 'User', id: 'saved-b', name: 'B', score: 0 });
  await b;
  first.reject(new Error('A failed'));
  await a;
  expect(client.getRequestResult(request).users.items.map(({ node }) => node.id)).toEqual([
    '1',
    'saved-b',
  ]);
  expect(client.store.read(toEntityId('User', 'temp-a'))).toBeUndefined();
  expect(client.store.read(toEntityId('User', 'temp-b'))).toBeUndefined();
});

for (const succeeds of [true, false]) {
  test(`optimistic deletion ${succeeds ? 'commits' : 'rolls back'} without losing concurrent owner updates`, async () => {
    const response = Promise.withResolvers<Partial<User>>();
    const mutations = { remove: mutation<User, { id: string }, Partial<User>>('User') };
    const client = createClient<[FateRoots, typeof mutations]>({
      mutations,
      roots: {},
      transport: { fetchById: async () => [], mutate: vi.fn().mockReturnValue(response.promise) },
      types: [
        { type: 'User' },
        { fields: { label: 'scalar', users: { listOf: 'User' } }, type: 'Group' },
      ],
    });
    client.write(
      'Group',
      { id: 'g1', label: 'Initial', users: [initial] },
      new Set(['id', 'label', 'users.id', 'users.name', 'users.score']),
    );
    const promise = client.mutations
      .remove({ delete: true, input: { id: '1' } })
      .catch(() => undefined);
    expect(client.store.read(userId)).toBeUndefined();
    client.write('Group', { id: 'g1', label: 'Updated' }, new Set(['id', 'label']));
    if (succeeds) {
      response.resolve({ id: '1' });
    } else {
      response.reject(new Error('delete failed'));
    }
    await promise;
    expect(client.store.read(toEntityId('Group', 'g1'))).toMatchObject({ label: 'Updated' });
    expect(client.store.read(toEntityId('Group', 'g1'))?.users).toHaveLength(succeeds ? 0 : 1);
    if (succeeds) {
      expect(client.store.read(userId)).toBeUndefined();
    } else {
      expect(client.store.read(userId)).toMatchObject(initial);
    }
  });
}

test('subscribers see only the rebased optimistic value during concurrent updates', async () => {
  const { client, first, second } = setup();
  const a = client.mutations
    .edit({ input: { id: '1' }, optimistic: { name: 'Pending A' } })
    .catch(() => undefined);
  const b = client.mutations
    .edit({ input: { id: '1' }, optimistic: { name: 'Pending B' } })
    .catch(() => undefined);
  const observed: Array<unknown> = [];
  const unsubscribe = client.store.subscribe(userId, () =>
    observed.push(client.store.read(userId)?.name),
  );
  first.reject(new Error('failed'));
  await a;
  expect(client.store.read(userId)?.name).toBe('Pending B');
  expect(observed).toEqual([]);
  second.reject(new Error('failed'));
  await b;
  expect(observed).toEqual(['Initial']);
  unsubscribe();
});

test('pending edits preserve snapshots and field subscriptions across unrelated writes', async () => {
  const { client, first } = setup();
  const pending = client.mutations
    .edit({ input: { id: '1' }, optimistic: { name: 'Pending' } })
    .catch(() => undefined);
  const nameChanged = vi.fn();
  const scoreChanged = vi.fn();
  client.store.subscribe(userId, new Set(['name']), nameChanged);
  client.store.subscribe(userId, new Set(['score']), scoreChanged);
  const ref = client.ref('User', '1', UserView);
  const snapshot = client.readView(UserView, ref);
  const record = client.store.read(userId);

  for (let index = 0; index < 100; index++) {
    client.write('User', { id: 'unrelated', name: String(index) }, new Set(['id', 'name']));
  }
  expect(nameChanged).not.toHaveBeenCalled();
  expect(scoreChanged).not.toHaveBeenCalled();
  expect(client.store.read(userId)).toBe(record);
  expect(client.readView(UserView, ref)).toBe(snapshot);

  client.write('User', { id: '1', score: 5 }, new Set(['id', 'score']));
  expect(nameChanged).not.toHaveBeenCalled();
  expect(scoreChanged).toHaveBeenCalledTimes(1);
  first.reject(new Error('failed'));
  await pending;
  expect(nameChanged).toHaveBeenCalledTimes(1);
  expect(scoreChanged).toHaveBeenCalledTimes(1);
  await expect(client.readView(UserView, ref)).resolves.toMatchObject({
    data: { name: 'Initial', score: 5 },
  });
});

test('reads during rebasing see current data without replacing the visible cached snapshot', async () => {
  const { client, first } = setup();
  const pending = client.mutations
    .edit({ input: { id: '1' }, optimistic: { name: 'Pending' } })
    .catch(() => undefined);
  const ref = client.ref('User', '1', UserView);
  const snapshot = client.readView(UserView, ref);
  const duringRebase = client.store.update(() => {
    client.write('User', { id: '1', name: 'Server' }, new Set(['id', 'name']));
    return client.readView(UserView, ref);
  });

  await expect(duringRebase).resolves.toMatchObject({ data: { name: 'Server' } });
  expect(client.readView(UserView, ref)).toBe(snapshot);
  await expect(snapshot).resolves.toMatchObject({ data: { name: 'Pending' } });
  first.reject(new Error('failed'));
  await pending;
  await expect(client.readView(UserView, ref)).resolves.toMatchObject({
    data: { name: 'Server' },
  });
});

test('rebasing a pending insertion preserves unchanged list identity and subscriptions', async () => {
  const response = Promise.withResolvers<User>();
  const mutations = { create: mutation<User, { name: string }, User>('User') };
  const client = createClient<[FateRoots, typeof mutations]>({
    mutations,
    roots: { users: clientRoot('User') },
    transport: {
      fetchById: async () => [],
      fetchList: async () => ({
        items: [{ cursor: undefined, node: initial }],
        pagination: { hasNext: false, hasPrevious: false },
      }),
      mutate: vi.fn().mockReturnValue(response.promise),
    },
    types: [{ type: 'User' }],
  });
  const request = { users: { list: { items: { node: UserView } } } };
  await client.request(request);
  const pending = client.mutations
    .create({
      input: { name: 'Pending' },
      optimistic: { id: 'temp', name: 'Pending', score: 0 },
    })
    .catch(() => undefined);
  const list = client.store.getListState('users');
  const changed = vi.fn();
  client.store.subscribeList('users', changed);

  client.write('User', { id: '1', score: 5 }, new Set(['id', 'score']));
  expect(changed).not.toHaveBeenCalled();
  expect(client.store.getListState('users')).toBe(list);
  response.reject(new Error('failed'));
  await pending;
  expect(changed).toHaveBeenCalledTimes(1);
  expect(client.getRequestResult(request).users.items.map(({ node }) => node.id)).toEqual(['1']);
});

test('rebasing refreshes connection pagination even when its items stay the same', async () => {
  type Group = { __typename: 'Group'; id: string; name: string; users: Array<User> };
  const client = createClient({
    roots: {},
    transport: { fetchById: async () => [] },
    types: [{ type: 'User' }, { fields: { users: { listOf: 'User' } }, type: 'Group' }],
  });
  const writePage = (hasNext: boolean) =>
    client.write(
      'Group',
      {
        id: 'g1',
        users: {
          items: [{ cursor: 'c1', node: initial }],
          pagination: { hasNext, hasPrevious: false },
        },
      },
      new Set(['id', 'users.id', 'users.name', 'users.score']),
    );
  writePage(true);
  const settle = client.store.optimisticUpdate(() =>
    client.write('Group', { id: 'g1', name: 'Pending' }, new Set(['id', 'name'])),
  );
  const GroupView = view<Group>()({
    users: { items: { node: UserView }, pagination: { hasNext: true } },
  });
  const ref = client.ref('Group', 'g1', GroupView);
  await expect(client.readView(GroupView, ref)).resolves.toMatchObject({
    data: { users: { pagination: { hasNext: true } } },
  });
  const usersChanged = vi.fn();
  const nameChanged = vi.fn();
  client.store.subscribe(toEntityId('Group', 'g1'), new Set(['users']), usersChanged);
  client.store.subscribe(toEntityId('Group', 'g1'), new Set(['name']), nameChanged);
  writePage(false);
  await expect(client.readView(GroupView, ref)).resolves.toMatchObject({
    data: { users: { pagination: { hasNext: false } } },
  });
  expect(usersChanged).toHaveBeenCalledTimes(1);
  expect(nameChanged).not.toHaveBeenCalled();
  settle();
});

test('rollback retains newly fetched list pages without retaining failed optimistic entries', async () => {
  const response = Promise.withResolvers<User>();
  const mutations = { create: mutation<User, { name: string }, User>('User') };
  const incoming = { ...initial, id: '2', name: 'Fetched' };
  const fetchList = vi
    .fn()
    .mockResolvedValueOnce({
      items: [{ cursor: 'c1', node: initial }],
      pagination: { hasNext: false, hasPrevious: false },
    })
    .mockResolvedValueOnce({
      items: [
        { cursor: 'c1', node: initial },
        { cursor: 'c2', node: incoming },
      ],
      pagination: { hasNext: false, hasPrevious: false },
    });
  const client = createClient<[FateRoots, typeof mutations]>({
    mutations,
    roots: { users: clientRoot('User') },
    transport: {
      fetchById: async () => [],
      fetchList,
      mutate: vi.fn().mockReturnValue(response.promise),
    },
    types: [{ type: 'User' }],
  });
  const request = { users: { list: { items: { cursor: true, node: UserView } } } };
  await client.request(request);
  const pending = client.mutations
    .create({ input: { name: 'Pending' }, optimistic: { id: 'temp', name: 'Pending', score: 0 } })
    .catch(() => undefined);
  await client.request(request, { mode: 'network-only' });
  expect(client.getRequestResult(request).users.items.map(({ node }) => node.id)).toContain('temp');
  response.reject(new Error('failed'));
  await pending;
  expect(client.getRequestResult(request).users.items.map(({ node }) => node.id)).toEqual([
    '1',
    '2',
  ]);
});

test('settling a nested insertion does not resurrect its temporary reference', async () => {
  type GroupedUser = User & { group: { __typename: 'Group'; id: string } };
  const first = Promise.withResolvers<GroupedUser>();
  const second = Promise.withResolvers<GroupedUser>();
  const mutations = { create: mutation<GroupedUser, { name: string }, GroupedUser>('User') };
  const client = createClient<[FateRoots, typeof mutations]>({
    mutations,
    roots: {},
    transport: {
      fetchById: async () => [],
      mutate: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    },
    types: [
      { fields: { group: { type: 'Group' } }, type: 'User' },
      { fields: { users: { listOf: 'User' } }, type: 'Group' },
    ],
  });
  const group = { __typename: 'Group' as const, id: 'g1' };
  client.write('Group', { ...group, users: [] }, new Set(['id', 'users.id']));
  const a = client.mutations
    .create({ input: { name: 'A' }, optimistic: { ...initial, group, id: 'temp-a' } })
    .catch(() => undefined);
  const b = client.mutations.create({
    input: { name: 'B' },
    optimistic: { ...initial, group, id: 'temp-b' },
  });
  second.resolve({ ...initial, group, id: 'saved-b' });
  await b;
  const expected = [
    client.store.read(toEntityId('User', 'temp-a')),
    client.store.read(toEntityId('User', 'saved-b')),
  ];
  expect(expected.every(Boolean)).toBe(true);
  const refs = client.store.read(toEntityId('Group', 'g1'))?.users as Array<NodeRef>;
  expect(refs.map(getNodeRefId).sort()).toEqual([
    toEntityId('User', 'saved-b'),
    toEntityId('User', 'temp-a'),
  ]);
  first.reject(new Error('A failed'));
  await a;
  expect(
    ((client.store.read(toEntityId('Group', 'g1'))?.users ?? []) as Array<NodeRef>).map(
      getNodeRefId,
    ),
  ).toEqual([toEntityId('User', 'saved-b')]);
});
