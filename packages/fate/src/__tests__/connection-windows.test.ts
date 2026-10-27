import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { defer, isDeferred } from '../defer.ts';
import { createConnectionReader } from '../list.ts';
import { mutation } from '../mutation.ts';
import { clientRoot } from '../root.ts';
import type { Transport } from '../transport.ts';
import { ConnectionTag, type ConnectionMetadata, type ViewSelection } from '../types.ts';
import { view } from '../view.ts';

type Item = { __typename: 'Item'; id: string; name: string };
const ItemView = view<Item>()({ id: true, name: true });
const Selection = {
  items: { cursor: true, node: ItemView },
  pagination: { hasNext: true, nextCursor: true },
} as const;
const page = (ids: Array<string>, hasNext = true) => ({
  items: ids.map((id) => ({ cursor: id, node: { __typename: 'Item', id, name: id } })),
  pagination: { hasNext, hasPrevious: false, nextCursor: ids.at(-1), previousCursor: ids[0] },
});
const request = (first: number) => ({ items: { args: { first }, list: Selection } });
const setup = () => {
  const roots = { items: clientRoot<Item, 'Item'>('Item') };
  const mutations = { add: mutation<Item, { name: string }, Item>('Item') };
  const fetchList = vi.fn();
  const mutate = vi.fn();
  const subscribeConnection = vi.fn<NonNullable<Transport['subscribeConnection']>>(() => () => {});
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    roots,
    transport: { fetchById: async () => [], fetchList, mutate, subscribeConnection },
    types: [{ fields: { name: 'scalar' }, type: 'Item' }],
  });
  const read = (first: number) => client.getRequestResult(request(first)).items;
  const ids = (first: number) => read(first)?.items.map(({ node }) => node.id);
  return { client, fetchList, ids, mutate, read, request, subscribeConnection };
};

test.each(['before', 'after'] as const)(
  'a confirmed %s insertion survives a first-page refresh',
  async (position) => {
    const { client, fetchList, ids, mutate, read, request } = setup();
    fetchList.mockResolvedValue(page(['1', '2'], false));
    await client.request(request(2));
    mutate.mockResolvedValue({ __typename: 'Item', id: 'new', name: 'New' });
    await client.mutations.add({
      input: { name: 'New' },
      insert: { into: read(2)!, position },
      view: ItemView,
    });
    const expected = position === 'before' ? ['new', '1', '2'] : ['1', '2', 'new'];
    expect(ids(2)).toEqual(expected);
    await client.request(request(2), { mode: 'network-only' });
    expect(ids(2)).toEqual(expected);
    const restored = setup();
    const snapshot = JSON.stringify(client.dehydrate());
    restored.client.hydrate(JSON.parse(snapshot));
    restored.fetchList.mockResolvedValue(page(['1', '2'], false));
    await restored.client.request(request(2), { mode: 'network-only' });
    expect(restored.ids(2)).toEqual(expected);
    restored.client.deleteRecord('Item', 'new');
    expect(restored.ids(2)).toEqual(['1', '2']);
  },
);

test.each([true, false])(
  'an insertion racing a refresh settles without losing or leaking membership (success: %s)',
  async (success) => {
    const { client, fetchList, ids, mutate, read } = setup();
    fetchList.mockResolvedValue(page(['1', '2'], false));
    await client.request(request(2));
    const response = Promise.withResolvers<Item>();
    mutate.mockReturnValue(response.promise);
    const pending = client.mutations.add({
      input: { name: 'New' },
      insert: { into: read(2)!, position: 'before' },
      optimistic: { id: 'temporary', name: 'New' },
      view: ItemView,
    });
    const settled = pending.catch((error: unknown) => error);
    expect(ids(2)).toEqual(['temporary', '1', '2']);
    await client.request(request(2), { mode: 'network-only' });
    expect(ids(2)).toEqual(['temporary', '1', '2']);
    if (success) {
      response.resolve({ __typename: 'Item', id: 'new', name: 'New' });
    } else {
      response.reject(new Error('Rejected'));
    }
    await settled;
    expect(ids(2)).toEqual(success ? ['new', '1', '2'] : ['1', '2']);
    await client.request(request(2), { mode: 'network-only' });
    expect(ids(2)).toEqual(success ? ['new', '1', '2'] : ['1', '2']);
  },
);

test('a bounded request reuses a larger cached page without exposing its extra items', async () => {
  const { client, fetchList, ids, read, request } = setup();
  fetchList.mockResolvedValue(page(['1', '2', '3', '4'], false));
  await client.request(request(4));
  await client.request(request(2));
  expect(ids(2)).toEqual(['1', '2']);
  expect(read(2)?.pagination).toMatchObject({ hasNext: true, nextCursor: '2' });
  expect(ids(4)).toEqual(['1', '2', '3', '4']);
  expect(fetchList).toHaveBeenCalledTimes(1);
});

test('backward requests expose their own trailing window and previous cursor', async () => {
  const { client, fetchList } = setup();
  fetchList.mockResolvedValue(page(['1', '2', '3', '4'], false));
  await client.request({ items: { args: { last: 4 }, list: Selection } });
  const result = await client.request({ items: { args: { last: 2 }, list: Selection } });
  expect(result.items.items.map(({ node }) => node.id)).toEqual(['3', '4']);
  expect(result.items.pagination).toMatchObject({ hasPrevious: true, previousCursor: '3' });
  expect(fetchList).toHaveBeenCalledTimes(1);
});

test('cursor requests reuse their own cached window and fetch missing continuations', async () => {
  const { client, fetchList, request } = setup();
  fetchList.mockResolvedValueOnce(page(['1', '2', '3', '4']));
  await client.request(request(4));
  fetchList.mockResolvedValueOnce(page(['3', '4']));
  const next = { items: { args: { after: '2', first: 2 }, list: Selection } };
  expect((await client.request(next)).items.items.map(({ node }) => node.id)).toEqual(['3', '4']);
  expect((await client.request(next)).items.items.map(({ node }) => node.id)).toEqual(['3', '4']);
  expect(fetchList).toHaveBeenCalledTimes(2);
  fetchList.mockResolvedValueOnce(page(['5', '6']));
  const missing = { items: { args: { after: '4', first: 2 }, list: Selection } };
  expect((await client.request(missing)).items.items.map(({ node }) => node.id)).toEqual([
    '5',
    '6',
  ]);
  expect(fetchList).toHaveBeenCalledTimes(3);
});

test('nested views keep bounded windows while sharing entity updates', async () => {
  type Owner = { __typename: 'Owner'; id: string; items: Array<Item> };
  const OwnerView = view<Owner>()(({ first }: { first: number }) => ({
    id: true,
    items: { ...Selection, args: { first } },
  }));
  const fetchById = vi
    .fn()
    .mockResolvedValue([{ id: 'owner', items: page(['1', '2', '3', '4'], false) }]);
  const client = createClient({
    roots: {},
    transport: { fetchById },
    types: [{ fields: { items: { listOf: 'Item' } }, type: 'Owner' }, { type: 'Item' }],
  });
  const large = OwnerView({ first: 4 });
  const small = OwnerView({ first: 2 });
  await client.readView(large, client.ref('Owner', 'owner', large));
  const ref = client.ref<Owner>('Owner', 'owner', small);
  expect(
    (
      await client.readView<Owner, ViewSelection<typeof small>, typeof small>(small, ref)
    ).data.items.items.map(({ node }) => node.id),
  ).toEqual(['1', '2']);
  client.write('Item', { id: '1', name: 'Updated' }, new Set(['id', 'name']));
  const selected = (
    await client.readView<Owner, ViewSelection<typeof small>, typeof small>(small, ref)
  ).data.items.items[0].node;
  expect(
    (
      await client.readView<Item, ViewSelection<typeof ItemView>, typeof ItemView>(
        ItemView,
        selected,
      )
    ).data.name,
  ).toBe('Updated');
  expect(fetchById).toHaveBeenCalledTimes(1);
});

test.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])(
  'nested previews fetch a missing page boundary cursor (backwards: %s, inline: %s)',
  async (backwards, inline) => {
    type Owner = { __typename: 'Owner'; id: string; items: Array<Item> };
    const OwnerView = view<Owner>()(({ count }: { count: number }) => ({
      id: true,
      items: {
        ...Selection,
        args: backwards ? { last: count } : { first: count },
        items: { node: inline ? { id: true, name: true } : ItemView },
        pagination: {
          hasNext: true,
          hasPrevious: true,
          nextCursor: true,
          previousCursor: true,
        },
      },
    }));
    const withoutEdgeCursors = (ids: Array<string>, more = false) => ({
      items: ids.map((id) => ({ node: { __typename: 'Item', id, name: id } })),
      pagination: {
        hasNext: backwards ? false : more,
        hasPrevious: backwards ? more : false,
        nextCursor: `opaque-${ids.at(-1)}`,
        previousCursor: `opaque-${ids[0]}`,
      },
    });
    const fetchById = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'owner', items: withoutEdgeCursors(['1', '2', '3', '4']) }])
      .mockResolvedValueOnce([
        { id: 'owner', items: withoutEdgeCursors(backwards ? ['3', '4'] : ['1', '2'], true) },
      ])
      .mockResolvedValueOnce([
        { id: 'owner', items: withoutEdgeCursors(backwards ? ['1', '2'] : ['3', '4']) },
      ]);
    const client = createClient({
      roots: {},
      transport: { fetchById },
      types: [{ fields: { items: { listOf: 'Item' } }, type: 'Owner' }, { type: 'Item' }],
    });
    const large = OwnerView({ count: 4 });
    await client.readView(large, client.ref('Owner', 'owner', large));
    const small = OwnerView({ count: 2 });
    const ref = client.ref<Owner>('Owner', 'owner', small);
    const read = async () =>
      (await client.readView<Owner, ViewSelection<typeof small>, typeof small>(small, ref)).data
        .items;
    const connection = await read();
    expect(fetchById).toHaveBeenCalledTimes(2);
    expect(connection.items.map(({ node }) => node.id)).toEqual(
      backwards ? ['3', '4'] : ['1', '2'],
    );
    expect(connection.pagination).toMatchObject(
      backwards
        ? { hasPrevious: true, previousCursor: 'opaque-3' }
        : { hasNext: true, nextCursor: 'opaque-2' },
    );
    await createConnectionReader(client, windowMetadata(connection)).load(
      ItemView,
      backwards ? 'backward' : 'forward',
    );
    const loaded = await read();
    expect(loaded.items.map(({ node }) => node.id)).toEqual(['1', '2', '3', '4']);
    expect(loaded.pagination).toMatchObject({ hasNext: false, hasPrevious: false });
    expect(fetchById).toHaveBeenCalledTimes(3);
  },
);

test('refreshing a smaller preview does not truncate a larger cached window', async () => {
  const { client, fetchList, ids, request } = setup();
  fetchList.mockResolvedValueOnce(page(['1', '2', '3', '4']));
  await client.request(request(4));
  fetchList.mockResolvedValueOnce(page(['1', '2']));
  await client.request(request(2), { mode: 'network-only' });
  expect(ids(2)).toEqual(['1', '2']);
  expect(ids(4)).toEqual(['1', '2', '3', '4']);
});

test('refreshing the first page preserves explicitly loaded continuation pages', async () => {
  const { client, fetchList, ids, read, request } = setup();
  fetchList.mockResolvedValueOnce(page(['1', '2']));
  await client.request(request(2));
  const connection = read(2)!;
  fetchList.mockResolvedValueOnce(page(['3', '4']));
  await client.loadConnection(
    ItemView,
    (connection as unknown as { [ConnectionTag]: ConnectionMetadata })[ConnectionTag],
    { after: '2', first: 2 },
  );
  expect(ids(2)).toEqual(['1', '2', '3', '4']);
  fetchList.mockResolvedValueOnce(page(['1', '2']));
  await client.request(request(2), { mode: 'network-only' });
  expect(ids(2)).toEqual(['1', '2', '3', '4']);
  fetchList.mockResolvedValueOnce(page(['new', '1']));
  await client.request(request(2), { mode: 'network-only' });
  expect(ids(2)).toEqual(['new', '1', '2', '3', '4']);
  fetchList.mockResolvedValueOnce(page(['remaining'], false));
  await client.request(request(2), { mode: 'network-only' });
  expect(ids(2)).toEqual(['remaining']);
});

test.each([false, true])(
  'cursor-only pages retain their origin without satisfying unrelated cursors (backwards: %s)',
  async (backwards) => {
    const { client, fetchList } = setup();
    fetchList.mockResolvedValue(page(['1', '2'], false));
    const args = backwards ? { before: 'origin', last: 2 } : { after: 'origin', first: 2 };
    const initial = await client.request({ items: { args, list: Selection } });
    expect(initial.items.items.map(({ node }) => node.id)).toEqual(['1', '2']);
    const missing = backwards ? { before: 'unknown', last: 2 } : { after: 'unknown', first: 2 };
    expect(
      client.getRequestResult({ items: { args: missing, list: Selection } }).items.items,
    ).toEqual([]);
  },
);

test.each(['before', 'after'] as const)(
  'an acknowledged %s insertion can later be removed by an authoritative server result',
  async (position) => {
    const { client, fetchList, ids, mutate, read } = setup();
    fetchList.mockResolvedValueOnce(page(['1', '2'], false));
    await client.request(request(2));
    mutate.mockResolvedValue({ __typename: 'Item', id: 'new', name: 'New' });
    await client.mutations.add({
      input: { name: 'New' },
      insert: { into: read(2)!, position },
      view: ItemView,
    });
    const expected = position === 'before' ? ['new', '1', '2'] : ['1', '2', 'new'];
    fetchList.mockResolvedValueOnce(page(expected, false));
    await client.request(request(3), { mode: 'network-only' });
    expect(ids(2)).toEqual(expected);
    const restored = setup();
    const snapshot = JSON.stringify(client.dehydrate());
    restored.client.hydrate(JSON.parse(snapshot));
    if (position === 'after') {
      restored.fetchList.mockResolvedValueOnce(page(['1']));
      await restored.client.request(request(1), { mode: 'network-only' });
      expect(restored.ids(2)).toEqual(expected);
    }
    restored.fetchList.mockResolvedValueOnce(page(['1', '2'], false));
    await restored.client.request(request(2), { mode: 'network-only' });
    expect(restored.ids(2)).toEqual(['1', '2']);
  },
);

test('a separately requested cursor page does not corrupt a cached head window', async () => {
  const { client, fetchList, ids } = setup();
  fetchList.mockResolvedValueOnce(page(['1', '2']));
  await client.request(request(2));
  fetchList.mockResolvedValueOnce(page(['5', '6']));
  const cursorRequest = { items: { args: { after: '4', first: 2 }, list: Selection } };
  const result = await client.request(cursorRequest, { mode: 'network-only' });
  expect(result.items.items.map(({ node }) => node.id)).toEqual(['5', '6']);
  expect(ids(2)).toEqual(['1', '2']);
  expect((await client.request(cursorRequest)).items.items.map(({ node }) => node.id)).toEqual([
    '5',
    '6',
  ]);
  expect(fetchList).toHaveBeenCalledTimes(2);
});

test('nested views keep separately requested cursor pages separate from the head', async () => {
  type Owner = { __typename: 'Owner'; id: string; items: Array<Item> };
  const OwnerView = view<Owner>()(({ after }: { after?: string }) => ({
    id: true,
    items: {
      ...Selection,
      args: { first: 2, ...(after ? { after } : {}) },
      items: { node: { id: true, name: true } },
    },
  }));
  const head = OwnerView({});
  const later = OwnerView({ after: '4' });
  const fetchById = vi
    .fn()
    .mockResolvedValueOnce([{ id: 'owner', items: page(['1', '2']) }])
    .mockResolvedValueOnce([{ id: 'owner', items: page(['5', '6']) }]);
  const client = createClient({
    roots: {},
    transport: { fetchById },
    types: [{ fields: { items: { listOf: 'Item' } }, type: 'Owner' }, { type: 'Item' }],
  });
  const headRef = client.ref<Owner>('Owner', 'owner', head);
  await client.readView(head, headRef);
  const laterRef = client.ref<Owner>('Owner', 'owner', later);
  const selected = await client.readView<Owner, ViewSelection<typeof later>, typeof later>(
    later,
    laterRef,
  );
  expect(selected.data.items.items.map(({ node }) => node.id)).toEqual(['5', '6']);
  expect(
    (
      await client.readView<Owner, ViewSelection<typeof head>, typeof head>(head, headRef)
    ).data.items.items.map(({ node }) => node.id),
  ).toEqual(['1', '2']);
  expect(fetchById).toHaveBeenCalledTimes(2);
});

test.each([null, undefined])(
  'an absent cursor shares the head window and refreshes it authoritatively (%s)',
  async (after) => {
    const { client, fetchList, ids } = setup();
    fetchList.mockResolvedValueOnce(page(['1', '2']));
    await client.request(request(2));
    const head = { items: { args: { after, first: 2 }, list: Selection } };
    expect((await client.request(head)).items.items.map(({ node }) => node.id)).toEqual(['1', '2']);
    expect(fetchList).toHaveBeenCalledTimes(1);
    fetchList.mockResolvedValueOnce(page(['3', '4']));
    await client.request(head, { mode: 'network-only' });
    expect(ids(2)).toEqual(['3', '4']);
  },
);

test.each([false, true])(
  'page metadata supplies the boundary for independently bounded readers (backwards: %s)',
  async (backwards) => {
    const { client, fetchList } = setup();
    const withoutEdgeCursors = (ids: Array<string>, more: boolean) => ({
      items: ids.map((id) => ({ node: { __typename: 'Item', id, name: id } })),
      pagination: {
        hasNext: backwards ? false : more,
        hasPrevious: backwards ? more : false,
        nextCursor: `opaque-${ids.at(-1)}`,
        previousCursor: `opaque-${ids[0]}`,
      },
    });
    const selection = (count: number) => ({
      items: { args: backwards ? { last: count } : { first: count }, list: Selection },
    });
    fetchList.mockResolvedValueOnce(withoutEdgeCursors(['1', '2', '3', '4'], false));
    await client.request(selection(4));
    fetchList.mockResolvedValueOnce(withoutEdgeCursors(backwards ? ['3', '4'] : ['1', '2'], true));
    const result = (await client.request(selection(2))).items;
    expect(result.items.map(({ node }) => node.id)).toEqual(backwards ? ['3', '4'] : ['1', '2']);
    expect(result.pagination).toMatchObject(
      backwards
        ? { hasPrevious: true, previousCursor: 'opaque-3' }
        : { hasNext: true, nextCursor: 'opaque-2' },
    );
    expect(fetchList).toHaveBeenCalledTimes(2);
    fetchList.mockResolvedValueOnce(withoutEdgeCursors(backwards ? ['1', '2'] : ['3', '4'], false));
    await client.loadConnection(
      ItemView,
      (result as unknown as { [ConnectionTag]: ConnectionMetadata })[ConnectionTag],
      backwards ? { before: 'opaque-3', last: 2 } : { after: 'opaque-2', first: 2 },
      { direction: backwards ? 'backward' : 'forward' },
    );
    const loaded = client.getRequestResult(selection(2)).items;
    expect(loaded.items.map(({ node }) => node.id)).toEqual(['1', '2', '3', '4']);
    expect(loaded.pagination).toMatchObject({ hasNext: false, hasPrevious: false });
  },
);

test.each(['before', 'after'] as const)(
  'a visible live %s insertion can be removed by a complete server result',
  async (position) => {
    const { client, fetchList, ids, read, subscribeConnection } = setup();
    fetchList.mockResolvedValue(page(['1', '2'], false));
    await client.request(request(2));
    const metadata = (read(2) as unknown as { [ConnectionTag]: ConnectionMetadata })[ConnectionTag];
    const unsubscribe = client.subscribeLiveListView(ItemView, {
      ...metadata,
      live: { append: 'visible', prepend: 'visible' },
    });
    subscribeConnection.mock.calls[0][5].onEvent({
      edge: { cursor: 'new', node: { __typename: 'Item', id: 'new', name: 'New' } },
      nodeType: 'Item',
      type: position === 'before' ? 'prependEdge' : 'appendEdge',
    });
    expect(ids(2)).toEqual(position === 'before' ? ['new', '1', '2'] : ['1', '2', 'new']);
    await client.request(request(2), { mode: 'network-only' });
    expect(ids(2)).toEqual(['1', '2']);
    unsubscribe();
  },
);

test('backward pagination keeps unique membership when items move across its cursor', async () => {
  const { client, fetchList } = setup();
  const largeRequest = { items: { args: { last: 8 }, list: Selection } };
  const smallRequest = { items: { args: { last: 2 }, list: Selection } };
  fetchList.mockResolvedValueOnce(page(['1', '2', '3', '4', '5', '6'], false));
  await client.request(largeRequest);
  const connection = (await client.request(smallRequest)).items;
  const reader = createConnectionReader(client, windowMetadata(connection));
  expect(reader.getSnapshot()?.ids).toEqual(['Item:5', 'Item:6']);
  fetchList.mockResolvedValueOnce({
    ...page(['6', '7']),
    pagination: { hasNext: true, hasPrevious: true, nextCursor: '7', previousCursor: '6' },
  });
  await reader.load(ItemView, 'backward');
  expect(client.getRequestResult(largeRequest).items.items.map(({ node }) => node.id)).toEqual([
    '1',
    '2',
    '3',
    '4',
    '6',
    '7',
    '5',
  ]);
  expect(reader.getSnapshot()?.ids).toEqual(['Item:6', 'Item:7', 'Item:5']);
  expect(fetchList).toHaveBeenCalledTimes(2);
});

test.each([false, true])(
  'a terminal page removes a stale cached continuation (backwards: %s)',
  async (backwards) => {
    const { client, fetchList } = setup();
    const selection = (count: number) => ({
      items: { args: backwards ? { last: count } : { first: count }, list: Selection },
    });
    fetchList.mockResolvedValueOnce(page(['1', '2', '3', '4', '5', '6'], false));
    await client.request(selection(6));
    const result = (await client.request(selection(2))).items;
    const metadata = (result as unknown as { [ConnectionTag]: ConnectionMetadata })[ConnectionTag];
    fetchList.mockResolvedValueOnce({
      ...page(['3', '4'], false),
      pagination: {
        hasNext: backwards,
        hasPrevious: !backwards,
        nextCursor: '4',
        previousCursor: '3',
      },
    });
    await client.loadConnection(
      ItemView,
      metadata,
      backwards ? { before: '5', last: 2 } : { after: '2', first: 2 },
      { direction: backwards ? 'backward' : 'forward' },
    );
    const loaded = client.getRequestResult(selection(2)).items;
    const expected = backwards ? ['3', '4', '5', '6'] : ['1', '2', '3', '4'];
    expect(loaded.items.map(({ node }) => node.id)).toEqual(expected);
    expect(loaded.pagination).toMatchObject({ hasNext: false, hasPrevious: false });
    expect(client.getRequestResult(selection(6)).items.items.map(({ node }) => node.id)).toEqual(
      expected,
    );
  },
);

const windowMetadata = (connection: unknown) =>
  (connection as { [ConnectionTag]: ConnectionMetadata })[ConnectionTag];

test('a logical view restores its own paginated range without adopting another view range', async () => {
  const { client, fetchList } = setup();
  const PreviewView = view<Item>()({ id: true, name: true });
  const previewRequest = {
    items: { args: { first: 2 }, list: { ...Selection, items: { node: PreviewView } } },
  };
  fetchList.mockResolvedValueOnce(page(['1', '2', '3', '4', '5', '6'], false));
  await client.request(request(6));
  const preview = (await client.request(previewRequest)).items;
  const feed = (await client.request(request(2))).items;
  const previewReader = createConnectionReader(client, windowMetadata(preview));
  const feedReader = createConnectionReader(client, windowMetadata(feed));
  fetchList.mockResolvedValueOnce(page(['3', '4']));
  await feedReader.load(ItemView, 'forward');
  expect(feedReader.getSnapshot()?.ids).toEqual(['Item:1', 'Item:2', 'Item:3', 'Item:4']);
  expect(previewReader.getSnapshot()?.ids).toEqual(['Item:1', 'Item:2']);
  expect(createConnectionReader(client, windowMetadata(feed)).getSnapshot()?.ids).toEqual([
    'Item:1',
    'Item:2',
    'Item:3',
    'Item:4',
  ]);
  expect(createConnectionReader(client, windowMetadata(preview)).getSnapshot()?.ids).toEqual([
    'Item:1',
    'Item:2',
  ]);
  expect(client.getRequestResult(request(2)).items.items.map(({ node }) => node.id)).toEqual([
    '1',
    '2',
    '3',
    '4',
  ]);
  expect(client.getRequestResult(previewRequest).items.items.map(({ node }) => node.id)).toEqual([
    '1',
    '2',
  ]);
  const restored = setup();
  const snapshot = JSON.stringify(client.dehydrate());
  restored.client.hydrate(JSON.parse(snapshot));
  const restoredFeed = restored.client.getRequestResult(request(2)).items;
  expect(
    createConnectionReader(restored.client, windowMetadata(restoredFeed)).getSnapshot()?.ids,
  ).toEqual(['Item:1', 'Item:2', 'Item:3', 'Item:4']);
  expect(fetchList).toHaveBeenCalledTimes(2);
});

test.each([false, true])(
  'nested logical views restore independent ranges (deferred: %s)',
  async (deferred) => {
    type Owner = { __typename: 'Owner'; id: string; items: Array<Item> };
    const connection = { ...Selection, args: { first: 2 } };
    const PreviewView = view<Owner>()({
      id: true,
      items: deferred ? defer(connection) : connection,
    });
    const FeedView = view<Owner>()({
      id: true,
      items: deferred ? defer(connection) : connection,
    });
    const LargeView = view<Owner>()({
      id: true,
      items: { ...Selection, args: { first: 6 }, items: { node: { id: true, name: true } } },
    });
    const fetchById = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'owner', items: page(['1', '2', '3', '4', '5', '6'], false) }]);
    const client = createClient({
      roots: {},
      transport: { fetchById },
      types: [{ fields: { items: { listOf: 'Item' } }, type: 'Owner' }, { type: 'Item' }],
    });
    await client.readView(LargeView, client.ref('Owner', 'owner', LargeView));
    const read = async (selected: typeof PreviewView) => {
      const snapshot = await client.readView<
        Owner,
        ViewSelection<typeof selected>,
        typeof selected
      >(selected, client.ref('Owner', 'owner', selected));
      const value = snapshot.data.items;
      return isDeferred(value) ? (await client.readDeferred(value)).data : value;
    };
    const preview = createConnectionReader(client, windowMetadata(await read(PreviewView)));
    const feed = createConnectionReader(client, windowMetadata(await read(FeedView)));
    fetchById.mockResolvedValueOnce([{ id: 'owner', items: page(['3', '4']) }]);
    await feed.load(ItemView, 'forward');
    expect(feed.getSnapshot()?.ids).toEqual(['Item:1', 'Item:2', 'Item:3', 'Item:4']);
    expect(preview.getSnapshot()?.ids).toEqual(['Item:1', 'Item:2']);
    const restored = createConnectionReader(client, windowMetadata(await read(FeedView)));
    expect(restored.getSnapshot()?.ids).toEqual(['Item:1', 'Item:2', 'Item:3', 'Item:4']);
    expect(
      createConnectionReader(client, windowMetadata(await read(PreviewView))).getSnapshot()?.ids,
    ).toEqual(['Item:1', 'Item:2']);
    expect(fetchById).toHaveBeenCalledTimes(2);
  },
);

test('independent head and tail queries do not replace each other with disconnected pages', async () => {
  const { client, fetchList } = setup();
  fetchList.mockResolvedValueOnce(page(['1', '2']));
  await client.request(request(2));
  const tail = { items: { args: { last: 2 }, list: Selection } };
  fetchList.mockResolvedValueOnce({
    ...page(['9', '10'], false),
    pagination: { hasNext: false, hasPrevious: true, nextCursor: '10', previousCursor: '9' },
  });
  expect((await client.request(tail)).items.items.map(({ node }) => node.id)).toEqual(['9', '10']);
  expect(client.getRequestResult(request(2)).items.items.map(({ node }) => node.id)).toEqual([
    '1',
    '2',
  ]);
  expect(client.getRequestResult(tail).items.items.map(({ node }) => node.id)).toEqual(['9', '10']);
  expect(fetchList).toHaveBeenCalledTimes(2);
});

test.each(['after', 'before'] as const)(
  'a null %s cursor shares first-page direction and retained pagination with an absent cursor',
  async (cursor) => {
    const { client, fetchList, read } = setup();
    fetchList.mockResolvedValueOnce(page(['1', '2']));
    await client.request(request(2));
    const head = { items: { args: { [cursor]: null, first: 2 }, list: Selection } };
    expect((await client.request(head)).items.items.map(({ node }) => node.id)).toEqual(['1', '2']);
    expect(fetchList).toHaveBeenCalledTimes(1);
    fetchList.mockResolvedValueOnce(page(['3', '4']));
    await client.loadConnection(ItemView, windowMetadata(read(2)), { after: '2', first: 2 });
    expect((await client.request(head)).items.items.map(({ node }) => node.id)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(fetchList).toHaveBeenCalledTimes(2);
  },
);

test('explicit insertions do not satisfy the server-page coverage of a larger request', async () => {
  const { client, fetchList, ids, mutate, read } = setup();
  fetchList.mockResolvedValueOnce(page(['1', '2']));
  await client.request(request(2));
  for (const id of ['new-a', 'new-b', 'new-c']) {
    mutate.mockResolvedValueOnce({ __typename: 'Item', id, name: id });
    await client.mutations.add({
      input: { name: id },
      insert: { into: read(2)!, position: 'before' },
      view: ItemView,
    });
  }
  fetchList.mockResolvedValueOnce(page(['1', '2', '3', '4', '5']));
  await client.request(request(5));
  expect(fetchList).toHaveBeenCalledTimes(2);
  expect(ids(5)).toEqual(['new-c', 'new-b', 'new-a', '1', '2', '3', '4', '5']);
});

test.each([false, true])(
  'local insertions not yet observed by a query survive an empty snapshot (cursor page: %s)',
  async (cursorPage) => {
    const { client, fetchList, ids, mutate, read } = setup();
    fetchList.mockResolvedValueOnce(page(['1', '2'], cursorPage));
    await client.request(request(2));
    mutate.mockResolvedValueOnce({ __typename: 'Item', id: 'new', name: 'New' });
    await client.mutations.add({
      input: { name: 'New' },
      insert: { into: read(2)!, position: cursorPage ? 'after' : 'before' },
      view: ItemView,
    });
    fetchList.mockResolvedValueOnce(page([], false));
    if (cursorPage) {
      await client.loadConnection(ItemView, windowMetadata(read(2)), { after: '2', first: 2 });
    } else {
      await client.request(request(2), { mode: 'network-only' });
    }
    expect(ids(2)).toEqual(cursorPage ? ['1', '2', 'new'] : ['new']);
    client.deleteRecord('Item', 'new');
    expect(ids(2)).toEqual(cursorPage ? ['1', '2'] : []);
  },
);
