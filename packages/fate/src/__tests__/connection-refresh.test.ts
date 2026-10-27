import { expect, test, vi } from 'vite-plus/test';
import { alias } from '../alias.ts';
import { createClient } from '../client.ts';
import { mutation } from '../mutation.ts';
import { createNodeRef } from '../node-ref.ts';
import { clientRoot } from '../root.ts';
import type { Transport } from '../transport.ts';
import { ConnectionTag, type ConnectionMetadata, type SelectionOf } from '../types.ts';
import { view } from '../view.ts';

type User = { __typename: 'User'; id: string; name: string };
type Group = { __typename: 'Group'; id: string; users: Array<User> };
const UserView = view<User>()({ id: true, name: true });
const pagination = {
  hasNext: true,
  hasPrevious: true,
  nextCursor: true,
  previousCursor: true,
} as const;
const page = (ids: Array<string>, hasNext = false) => ({
  items: ids.map((id) => ({ cursor: `cursor-${id}`, node: { id, name: id } })),
  pagination: {
    hasNext,
    hasPrevious: false,
    nextCursor: ids.length ? `cursor-${ids.at(-1)}` : undefined,
    previousCursor: ids.length ? `cursor-${ids[0]}` : undefined,
  },
});
const connection = (status: string) => ({
  args: { first: 20, status },
  items: { node: UserView },
});

const setup = (inline = false) => {
  const Selection = {
    args: { first: 20 },
    items: { cursor: true, node: inline ? ({ id: true, name: true } as const) : UserView },
    pagination,
  };
  const GroupView = view<Group>()({ id: true, users: Selection });
  const roots = { group: clientRoot<Group, 'Group'>('Group') };
  const mutations = { update: mutation<Group, { id: string }, Group>('Group') };
  const fetchQuery = vi.fn<NonNullable<Transport['fetchQuery']>>();
  const mutate = vi.fn();
  const fetchById = vi.fn<Transport['fetchById']>(async () => []);
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    roots,
    transport: { fetchById, fetchQuery, mutate },
    types: [{ fields: { users: { listOf: 'User' } }, type: 'Group' }, { type: 'User' }],
  });
  const request = { group: { view: GroupView } };
  const ref = client.ref('Group', 'g', GroupView);
  const read = async () =>
    (await client.readView<Group, SelectionOf<typeof GroupView>, typeof GroupView>(GroupView, ref))
      .data.users;
  const refresh = async (ids: Array<string>, hasNext = false) => {
    fetchQuery.mockResolvedValueOnce({ id: 'g', users: page(ids, hasNext) });
    await client.request(request, { mode: 'network-only' });
    return await read();
  };
  return { client, fetchById, fetchQuery, GroupView, mutate, read, refresh, Selection };
};
const metadata = (connection: unknown) =>
  (connection as { [ConnectionTag]: ConnectionMetadata })[ConnectionTag];

test.each([false, true])(
  'refresh replaces nested membership, including reorder, removals, and empty snapshots (inline: %s)',
  async (inline) => {
    const { client, fetchQuery, refresh } = setup(inline);
    const first = await refresh(['1', '2', '3']);
    const connection = metadata(first);
    const listChanged = vi.fn();
    const parentChanged = vi.fn();
    const unsubscribeList = client.store.subscribeList(connection.key, listChanged);
    const unsubscribeParent = client.store.subscribe('Group:g', new Set(['users']), parentChanged);
    try {
      const reordered = await refresh(['3', '4', '1']);
      expect(reordered.items.map(({ node }) => node.id)).toEqual(['3', '4', '1']);
      expect(reordered.items.map(({ cursor }) => cursor)).toEqual([
        'cursor-3',
        'cursor-4',
        'cursor-1',
      ]);
      expect((await refresh(['4'])).items.map(({ node }) => node.id)).toEqual(['4']);
      expect((await refresh([])).items).toEqual([]);
      expect(client.store.getListState(connection.key)?.ids).toEqual([]);
      expect(client.store.read('User:2')).toMatchObject({ id: '2', name: '2' });
      expect(listChanged).toHaveBeenCalledTimes(3);
      expect(parentChanged).toHaveBeenCalledTimes(3);
      expect(fetchQuery).toHaveBeenCalledTimes(4);
    } finally {
      unsubscribeList();
      unsubscribeParent();
    }
  },
);

test.each([false, true])(
  'complete empty refresh clears stale pagination cursors (inline: %s)',
  async (inline) => {
    const { client, refresh } = setup(inline);
    const first = await refresh(['1', '2'], true);
    const empty = await refresh([]);
    expect(empty.pagination).toEqual({ hasNext: false, hasPrevious: false });
    expect(client.store.getListState(metadata(first).key)?.pagination).toEqual({
      hasNext: false,
      hasPrevious: false,
      nextCursor: undefined,
      previousCursor: undefined,
    });
  },
);

test.each([false, true])(
  'mutation responses replace nested relationships without deleting shared records (inline: %s)',
  async (inline) => {
    const { client, GroupView, mutate, read, refresh } = setup(inline);
    await refresh(['1', '2']);
    mutate.mockResolvedValueOnce({ id: 'g', users: page(['2']) });
    const result = await client.mutations.update({ input: { id: 'g' }, view: GroupView });
    expect(result.error).toBeUndefined();
    expect((await read()).items.map(({ node }) => node.id)).toEqual(['2']);
    expect(client.store.read('User:1')).toMatchObject({ id: '1', name: '1' });
  },
);

test('ordinary nested array responses also replace their previous membership', async () => {
  const { client, fetchQuery } = setup();
  const GroupView = view<Group>()({ users: { id: true, name: true } });
  const ref = client.ref('Group', 'g', GroupView);
  for (const ids of [['1', '2'], ['2'], []]) {
    fetchQuery.mockResolvedValueOnce({ id: 'g', users: ids.map((id) => ({ id, name: id })) });
    await client.request({ group: { view: GroupView } }, { mode: 'network-only' });
    const data = (
      await client.readView<Group, SelectionOf<typeof GroupView>, typeof GroupView>(GroupView, ref)
    ).data;
    expect(data.users.map((user) => user.id)).toEqual(ids);
  }
});

test('replacing one aliased argument scope leaves other nested connections unchanged', async () => {
  const { client, fetchQuery } = setup();
  const Active = view<Group>()({ active: alias('users', connection('active')) });
  const Archived = view<Group>()({ archived: alias('users', connection('archived')) });
  fetchQuery.mockResolvedValueOnce({ id: 'g', users: page(['1', '2']) });
  await client.request({ group: { view: Active } }, { mode: 'network-only' });
  fetchQuery.mockResolvedValueOnce({ id: 'g', users: page(['3']) });
  await client.request({ group: { view: Archived } }, { mode: 'network-only' });
  fetchQuery.mockResolvedValueOnce({ id: 'g', users: page([]) });
  await client.request({ group: { view: Active } }, { mode: 'network-only' });
  const active = (
    await client.readView<Group, SelectionOf<typeof Active>, typeof Active>(
      Active,
      client.ref('Group', 'g', Active),
    )
  ).data;
  const archived = (
    await client.readView<Group, SelectionOf<typeof Archived>, typeof Archived>(
      Archived,
      client.ref('Group', 'g', Archived),
    )
  ).data;
  expect(active.active.items).toEqual([]);
  expect(archived.archived.items.map(({ node }) => node.id)).toEqual(['3']);
});

test('an optimistic rollback restores the latest refreshed membership rather than the original list', async () => {
  const { client, read, refresh } = setup();
  await refresh(['1', '2']);
  const rollback = client.store.optimisticUpdate(() => client.deleteRecord('User', '1'));
  await refresh(['2', '3']);
  expect((await read()).items.map(({ node }) => node.id)).toEqual(['2', '3']);
  rollback();
  expect((await read()).items.map(({ node }) => node.id)).toEqual(['2', '3']);
  expect(client.store.read('User:1')).toMatchObject({ id: '1' });
});

test('a partial first-page refresh retains loaded pages and can paginate again', async () => {
  const { client, fetchById, read, refresh, Selection } = setup();
  const first = await refresh(['1'], true);
  const connection = metadata(first);
  fetchById.mockResolvedValueOnce([{ id: 'g', users: page(['2']) }]);
  await client.loadConnection(UserView, connection, { after: 'cursor-1', first: 1 });
  expect(client.store.getListState(connection.key)?.ids).toEqual(['User:1', 'User:2']);
  await refresh(['3'], true);
  expect(client.store.getListState(connection.key)?.ids).toEqual(['User:3', 'User:1', 'User:2']);
  fetchById.mockResolvedValueOnce([{ id: 'g', users: page(['4']) }]);
  await client.loadConnection(Selection.items.node, connection, {
    after: (await read()).pagination.nextCursor,
    first: 1,
  });
  expect((await read()).items.map(({ node }) => node.id)).toEqual(['3', '1', '2', '4']);
});

test('a smaller preview refresh retains the larger cached window', async () => {
  const { client, fetchQuery, refresh, Selection } = setup();
  const initial = await refresh(['1', '2']);
  const Smaller = view<Group>()({ users: { ...Selection, args: { first: 1 } } });
  fetchQuery.mockResolvedValueOnce({ id: 'g', users: page(['1'], true) });
  await client.request({ group: { view: Smaller } }, { mode: 'network-only' });
  expect(client.store.getListState(metadata(initial).key)).toMatchObject({
    forwardPageLimit: 20,
    ids: ['User:1', 'User:2'],
    pagination: { hasNext: false },
  });
});

test('explicit optimistic relationships replace membership and roll back onto a newer server snapshot', async () => {
  const { client, GroupView, mutate, read, refresh } = setup();
  await refresh(['1', '2']);
  const response = Promise.withResolvers<unknown>();
  mutate.mockReturnValueOnce(response.promise);
  const pending = client.mutations
    .update({
      input: { id: 'g' },
      optimistic: { users: [{ id: '2', name: '2' }] },
      view: GroupView,
    })
    .catch(() => undefined);
  expect((await read()).items.map(({ node }) => node.id)).toEqual(['2']);
  await refresh(['3']);
  expect((await read()).items.map(({ node }) => node.id)).toEqual(['2']);
  response.reject(new Error('Rejected'));
  await pending;
  expect((await read()).items.map(({ node }) => node.id)).toEqual(['3']);
});

test('terminal nested pagination reconciles both membership and owner references', async () => {
  const { client, fetchById, read, refresh } = setup();
  const first = await refresh(['1', '2', '3', '4']);
  const connection = metadata(first);
  fetchById.mockResolvedValueOnce([{ id: 'g', users: page(['2']) }]);
  await client.loadConnection(UserView, connection, { after: 'cursor-1', first: 1 });
  expect((await read()).items.map(({ node }) => node.id)).toEqual(['1', '2']);
  expect(client.store.read('Group:g')?.users).toEqual([
    createNodeRef('User:1'),
    createNodeRef('User:2'),
  ]);
});
