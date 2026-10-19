import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { clientRoot } from '../root.ts';
import type { ConnectionMetadata, Pagination, ViewSelection } from '../types.ts';
import { ConnectionTag } from '../types.ts';
import { view } from '../view.ts';

type User = { __typename: 'User'; bio: string; friends: Array<User>; id: string; name: string };
type Page = {
  items: Array<{ cursor: string; node: { bio?: string; id: string; name: string } }>;
  pagination: Pagination;
};
const Name = view<User>()({ id: true, name: true });
const Profile = view<User>()({ bio: true, id: true, name: true });
const Friends = view<User>()({
  friends: { args: { first: 1 }, items: { node: Profile } },
  id: true,
});
const rootRequest = { users: { args: { first: 1 }, list: { items: { node: Profile } } } };
const page = (id: string, name = id, pagination: Partial<Pagination> = {}): Page => ({
  items: [{ cursor: id, node: { bio: 'Biography', id, name } }],
  pagination: {
    hasNext: true,
    hasPrevious: true,
    nextCursor: id,
    previousCursor: id,
    ...pagination,
  },
});

const setup = async (nested: boolean) => {
  const pending: Array<ReturnType<typeof Promise.withResolvers<Page>>> = [];
  const fetchPage = vi.fn(() => {
    if (fetchPage.mock.calls.length === 1) {
      return Promise.resolve(page('1'));
    }
    const request = Promise.withResolvers<Page>();
    pending.push(request);
    return request.promise;
  });
  const client = createClient({
    roots: {
      users: clientRoot<User, 'User'>('User'),
      viewer: clientRoot<User, 'User'>('User'),
    },
    transport: {
      fetchById: async () => [{ friends: await fetchPage(), id: 'owner' }],
      fetchList: fetchPage,
      fetchQuery: async () => ({ friends: await fetchPage(), id: 'owner' }),
    },
    types: [{ fields: { friends: { listOf: 'User' } }, type: 'User' }],
  });
  const refresh = () =>
    nested
      ? client.request({ viewer: { view: Friends } }, { mode: 'network-only' })
      : client.request(rootRequest, { mode: 'network-only' });
  let connection: unknown;
  if (nested) {
    const { viewer } = await client.request({ viewer: { view: Friends } });
    connection = (
      await client.readView<User, ViewSelection<typeof Friends>, typeof Friends>(Friends, viewer)
    ).data.friends;
  } else {
    connection = (await client.request(rootRequest)).users;
  }
  const metadata = (connection as unknown as { [ConnectionTag]: ConnectionMetadata })[
    ConnectionTag
  ];
  const load = (args = { after: '1', first: 1 }) => client.loadConnection(Profile, metadata, args);
  return { client, fetchPage, load, metadata, pending, refresh };
};

test.each([false, true])(
  'late pagination preserves confirmed fields and fills disjoint fields (nested: %s)',
  async (nested) => {
    const { client, load, pending } = await setup(nested);
    const loading = load();
    client.write(
      'User',
      { id: '2', name: 'Confirmed' },
      new Set(['id', 'name']),
      undefined,
      'none',
    );
    pending[0].resolve(page('2', 'Old'));
    await loading;
    expect(client.store.read('User:2')).toMatchObject({ bio: 'Biography', name: 'Confirmed' });
  },
);

test.each([false, true])(
  'late pagination cannot resurrect a deleted record or insert its reference (nested: %s)',
  async (nested) => {
    const { client, load, metadata, pending } = await setup(nested);
    client.write('User', { id: '2', name: 'Original' }, new Set(['id', 'name']), undefined, 'none');
    const loading = load();
    client.deleteRecord('User', '2');
    pending[0].resolve(page('2'));
    await loading;
    expect(client.store.read('User:2')).toBeUndefined();
    expect(client.store.getListState(metadata.key)?.ids).toEqual(['User:1']);
  },
);

test.each([false, true])(
  'a newer refresh replaces the list without a late page restoring its old window (nested: %s)',
  async (nested) => {
    const { client, load, metadata, pending, refresh } = await setup(nested);
    const loading = load();
    const refreshing = refresh();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1].resolve(page('3', 'Fresh', { hasNext: false }));
    await refreshing;
    const refreshed = client.store.getListState(metadata.key);
    pending[0].resolve(page('2', 'Old'));
    await loading;
    expect(client.store.getListState(metadata.key)).toBe(refreshed);
    expect(refreshed?.pagination).toMatchObject({ hasNext: false, nextCursor: '3' });
  },
);

test.each([false, true])(
  'equivalent concurrent page loads share delivery and can retry after failure (nested: %s)',
  async (nested) => {
    const { client, fetchPage, load, metadata, pending } = await setup(nested);
    const first = load();
    const duplicate = load({ after: '1', first: 1 });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    const error = new Error('Disconnected');
    const failed = Promise.allSettled([first, duplicate]);
    pending[0].reject(error);
    expect(await failed).toEqual([
      { reason: error, status: 'rejected' },
      { reason: error, status: 'rejected' },
    ]);
    const retry = load();
    expect(fetchPage).toHaveBeenCalledTimes(3);
    pending[1].resolve(page('2'));
    await retry;
    expect(client.store.getListState(metadata.key)?.ids).toEqual(['User:1', 'User:2']);
  },
);

test.each([false, true])(
  'a page using the old cursor window cannot append after an already-pending refresh completes (nested: %s)',
  async (nested) => {
    const { client, load, metadata, pending, refresh } = await setup(nested);
    const refreshing = refresh();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const loading = load();
    pending[0].resolve(page('3', 'Refreshed', { hasNext: false }));
    await refreshing;
    const refreshed = client.store.getListState(metadata.key);
    pending[1].resolve(page('2', 'Old window'));
    await loading;
    expect(client.store.getListState(metadata.key)).toBe(refreshed);
  },
);

test.each([false, true])(
  'different selections do not share an incomplete page response (nested: %s)',
  async (nested) => {
    const { client, fetchPage, load, metadata, pending } = await setup(nested);
    const profile = load();
    const name = client.loadConnection(Name, metadata, { after: '1', first: 1 });
    expect(fetchPage).toHaveBeenCalledTimes(3);
    pending[1].resolve({
      items: [{ cursor: '2', node: { id: '2', name: 'New' } }],
      pagination: { hasNext: false, hasPrevious: true },
    });
    await name;
    pending[0].resolve(page('2', 'Old'));
    await profile;
    expect(client.store.read('User:2')).toMatchObject({ bio: 'Biography', name: 'New' });
  },
);

test.each([false, true])(
  'a page requested after refresh does not reuse a stale in-flight page (nested: %s)',
  async (nested) => {
    const { client, fetchPage, load, metadata, pending, refresh } = await setup(nested);
    const older = load();
    const refreshing = refresh();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1].resolve(page('1', 'Refreshed'));
    await refreshing;
    const newer = load();
    expect(fetchPage).toHaveBeenCalledTimes(4);
    pending[2].resolve(page('2', 'Fresh page'));
    await newer;
    pending[0].resolve(page('2', 'Stale page'));
    await older;
    expect(client.store.read('User:2')?.name).toBe('Fresh page');
    expect(client.store.getListState(metadata.key)?.ids).toEqual(['User:1', 'User:2']);
  },
);

test('a late nested page cannot restore its deleted owner', async () => {
  const { client, load, metadata, pending } = await setup(true);
  const loading = load();
  client.deleteRecord('User', 'owner');
  const afterDeletion = client.store.getListState(metadata.key);
  pending[0].resolve(page('2'));
  await loading;
  expect(client.store.read('User:owner')).toBeUndefined();
  expect(client.store.getListState(metadata.key)).toBe(afterDeletion);
});

test.each([false, true])(
  'concurrent forward and backward pages both extend the list when they arrive in reverse order (nested: %s)',
  async (nested) => {
    const { client, load, metadata, pending } = await setup(nested);
    const forward = load();
    const backward = client.loadConnection(
      Profile,
      metadata,
      { before: '1', first: undefined, last: 1 },
      { direction: 'backward' },
    );
    pending[1].resolve(page('0', 'Previous', { hasNext: true, hasPrevious: false }));
    await backward;
    pending[0].resolve(page('2', 'Next', { hasNext: false, hasPrevious: true }));
    await forward;
    expect(client.store.getListState(metadata.key)).toMatchObject({
      ids: ['User:0', 'User:1', 'User:2'],
      pagination: {
        hasNext: false,
        hasPrevious: false,
        nextCursor: '2',
        previousCursor: '0',
      },
    });
  },
);
