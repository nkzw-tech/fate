import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { clientRoot } from '../root.ts';
import { view } from '../view.ts';

type User = { __typename: 'User'; bio: string; id: string; name: string };
const Name = view<User>()({ id: true, name: true });
const Profile = view<User>()({ bio: true, id: true, name: true });
const setup = () => {
  const pending: Array<(record: Record<string, unknown> | null) => void> = [];
  const client = createClient({
    roots: { viewer: clientRoot<User | null, 'User'>('User') },
    transport: {
      fetchById: vi.fn(async () => []),
      fetchQuery: vi.fn(
        () => new Promise<Record<string, unknown> | null>((resolve) => pending.push(resolve)),
      ),
    },
    types: [{ type: 'User' }],
  });
  const start = (profile = false) =>
    client.request({ viewer: { view: profile ? Profile : Name } }, { mode: 'network-only' });
  return { client, pending, start };
};

test('older overlapping responses preserve newer fields and still fill disjoint fields', async () => {
  const { client, pending, start } = setup();
  const older = start(true);
  const newer = start();
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  pending[1]({ id: '1', name: 'New' });
  await newer;
  pending[0]({ bio: 'Biography', id: '1', name: 'Old' });
  await older;
  expect(client.store.read('User:1')).toMatchObject({ bio: 'Biography', name: 'New' });
});

test('an omitted selected field in a newer response cannot be filled by an older response', async () => {
  const { client, pending, start } = setup();
  const older = start(true);
  const newer = client.request(
    { viewer: { view: view<User>()({ bio: true, id: true }) } },
    { mode: 'network-only' },
  );
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  pending[1]({ id: '1' });
  await newer;
  pending[0]({ bio: 'Old biography', id: '1', name: 'Name' });
  await older;

  expect(client.store.read('User:1')).toMatchObject({ id: '1', name: 'Name' });
  expect(client.store.read('User:1')?.bio).toBeUndefined();
  expect(client.store.missingForSelection('User:1', ['bio'])).toEqual(new Set());
});

test('older nullable root results cannot erase a newer root result', async () => {
  const { client, pending, start } = setup();
  const older = start(true);
  const newer = start();
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  pending[1]({ id: '1', name: 'New' });
  await newer;
  pending[0](null);
  await older;
  const result = await client.request({ viewer: { view: Name } });
  expect(result.viewer).toMatchObject({ id: '1' });
});

test('a late request cannot overwrite a confirmed local write or resurrect a deletion', async () => {
  const { client, pending, start } = setup();
  const older = start();
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  client.write('User', { id: '1', name: 'Confirmed' }, new Set(['id', 'name']));
  pending[0]({ id: '1', name: 'Old' });
  await older;
  expect(client.store.read('User:1')?.name).toBe('Confirmed');
  const deleting = start();
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  client.deleteRecord('User', '1');
  pending[1]({ id: '1', name: 'Resurrected' });
  await deleting;
  expect(client.store.read('User:1')).toBeUndefined();
});

test('preserves local writes when a subscriber starts another request during normalization', async () => {
  type Person = User & { friend: User };
  const pending: Array<(record: Record<string, unknown>) => void> = [];
  const client = createClient({
    roots: { viewer: clientRoot<Person, 'User'>('User') },
    transport: {
      fetchById: async () => [],
      fetchQuery: () => new Promise<Record<string, unknown>>((resolve) => pending.push(resolve)),
    },
    types: [{ fields: { friend: { type: 'User' } }, type: 'User' }],
  });
  let next: Promise<unknown> | undefined;
  const unsubscribe = client.store.subscribe('User:2', () => {
    next = client.request({ viewer: { view: Name } }, { mode: 'network-only' });
  });
  const first = client.request({ viewer: { view: view<Person>()({ friend: Name, id: true }) } });
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  pending[0]({ friend: { id: '2', name: 'Friend' }, id: '1' });
  await first;
  unsubscribe();
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  client.write('User', { id: '1', name: 'Confirmed' }, new Set(['name']));
  pending[1]({ id: '1', name: 'Stale' });
  await next;
  expect(client.store.read('User:1')?.name).toBe('Confirmed');
});

test('requests update the confirmed base beneath optimistic writes and rollback reveals it', async () => {
  const { client, pending, start } = setup();
  client.write('User', { id: '1', name: 'Initial' }, new Set(['id', 'name']));
  const older = start();
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  const settle = client.store.optimisticUpdate(() =>
    client.write('User', { id: '1', name: 'Optimistic' }, new Set(['name'])),
  );
  pending[0]({ id: '1', name: 'Server' });
  await older;
  expect(client.store.read('User:1')?.name).toBe('Optimistic');
  settle();
  expect(client.store.read('User:1')?.name).toBe('Server');
});

test('orders overlapping by-ID reads independently of the requesting view', async () => {
  const pending: Array<(records: Array<Record<string, unknown>>) => void> = [];
  const client = createClient({
    roots: { viewer: clientRoot<User, 'User'>('User') },
    transport: { fetchById: () => new Promise((resolve) => pending.push(resolve)) },
    types: [{ type: 'User' }],
  });
  const older = client.request({ viewer: { id: '1', view: Profile } });
  const newer = client.request({ viewer: { id: '1', view: Name } });
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  pending[1]([{ id: '1', name: 'New' }]);
  await newer;
  pending[0]([{ bio: 'Bio', id: '1', name: 'Old' }]);
  await older;
  expect(client.store.read('User:1')).toMatchObject({ bio: 'Bio', name: 'New' });
});

test('an older relation response fills disjoint child fields without replacing its newer link', async () => {
  type Person = {
    __typename: 'User';
    bio: string;
    friend: Person | null;
    id: string;
    name: string;
  };
  const pending: Array<(records: Array<Record<string, unknown>>) => void> = [];
  const client = createClient({
    roots: { user: clientRoot<Person, 'User'>('User') },
    transport: { fetchById: () => new Promise((resolve) => pending.push(resolve)) },
    types: [{ fields: { friend: { type: 'User' } }, type: 'User' }],
  });
  const older = client.request({
    user: {
      id: '1',
      view: view<Person>()({ friend: { bio: true, id: true, name: true }, id: true }),
    },
  });
  const newer = client.request({
    user: { id: '1', view: view<Person>()({ friend: { id: true, name: true }, id: true }) },
  });
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  pending[1]([{ friend: { id: '2', name: 'New' }, id: '1' }]);
  await newer;
  pending[0]([{ friend: { bio: 'Bio', id: '2', name: 'Old' }, id: '1' }]);
  await older;
  expect(client.store.read('User:2')).toMatchObject({ bio: 'Bio', name: 'New' });
});

test('an older root list response fills disjoint item fields without replacing the newer page', async () => {
  type Connection = {
    items: Array<{ cursor: string | undefined; node: Record<string, unknown> }>;
    pagination: { hasNext: boolean; hasPrevious: boolean };
  };
  const pending: Array<(connection: Connection) => void> = [];
  const client = createClient({
    roots: { users: clientRoot<User, 'User'>('User') },
    transport: {
      fetchById: async () => [],
      fetchList: () => new Promise<Connection>((resolve) => pending.push(resolve)),
    },
    types: [{ type: 'User' }],
  });
  const older = client.request({
    users: { args: { first: 1 }, list: { items: { node: Profile } } },
  });
  const newer = client.request({ users: { args: { first: 1 }, list: { items: { node: Name } } } });
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  pending[1]({
    items: [{ cursor: undefined, node: { id: '1', name: 'New' } }],
    pagination: { hasNext: false, hasPrevious: false },
  });
  await newer;
  pending[0]({
    items: [{ cursor: undefined, node: { bio: 'Bio', id: '1', name: 'Old' } }],
    pagination: { hasNext: true, hasPrevious: false },
  });
  await older;
  expect(client.store.read('User:1')).toMatchObject({ bio: 'Bio', name: 'New' });
});

test('late requests do not overwrite optimistic mutations after they commit', async () => {
  const { client, pending, start } = setup();
  client.write('User', { id: '1', name: 'Initial' }, new Set(['id', 'name']));
  const older = start();
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  const settle = client.store.optimisticUpdate(() =>
    client.write('User', { id: '1', name: 'Optimistic' }, new Set(['name'])),
  );
  settle(() => client.write('User', { id: '1', name: 'Confirmed' }, new Set(['name'])));
  pending[0]({ id: '1', name: 'Old' });
  await older;
  expect(client.store.read('User:1')?.name).toBe('Confirmed');
});

test('write-version history exists only while network responses can still arrive stale', async () => {
  const { client, pending, start } = setup();
  const { fieldWriteVersions, writeVersions } = client as unknown as {
    fieldWriteVersions: ReadonlyMap<string, ReadonlyMap<string, number>>;
    writeVersions: ReadonlyMap<string, number>;
  };
  const historySize = () => fieldWriteVersions.size + writeVersions.size;
  for (let index = 0; index < 1000; index++) {
    client.write('User', { id: String(index), name: 'Local' }, new Set(['name']));
  }
  client.gc();
  expect(historySize()).toBe(0);
  const older = start();
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  client.write('User', { id: '1', name: 'Confirmed' }, new Set(['name']));
  expect(historySize()).toBeGreaterThan(0);
  pending[0]({ id: '1', name: 'Stale' });
  await older;
  expect(client.store.read('User:1')?.name).toBe('Confirmed');
  expect(historySize()).toBe(0);
  client.deleteRecord('User', '1');
  expect(historySize()).toBe(0);
});
