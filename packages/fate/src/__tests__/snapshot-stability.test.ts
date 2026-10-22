import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { clientRoot } from '../root.ts';
import { view } from '../view.ts';

type User = {
  __typename: 'User';
  character: { color: number };
  id: string;
  name: string;
  tags: Array<string>;
};
const UserView = view<User>()({ character: { color: true }, name: true, tags: true });
const setup = () => {
  const fetchQuery = vi.fn(async () => ({
    character: { color: 1 },
    id: '1',
    name: 'Sam',
    tags: ['pvp'],
  }));
  const client = createClient({
    roots: { viewer: clientRoot<User, 'User'>('User') },
    transport: { fetchById: async () => [], fetchQuery },
    types: [{ fields: { character: { embedded: 'Character' }, tags: 'scalar' }, type: 'User' }],
  });
  return { client, fetchQuery };
};

test('identical refreshes preserve snapshots and do not notify selected subscribers', async () => {
  const { client } = setup();
  const request = { viewer: { view: UserView } };
  const { viewer } = await client.request(request);
  const first = await client.readView(UserView, viewer);
  const notify = vi.fn();
  const dispose = client.store.subscribe(
    'User:1',
    new Set(['character.color', 'name', 'tags']),
    notify,
  );
  await client.request(request, { mode: 'network-only' });
  expect(await client.readView(UserView, viewer)).toBe(first);
  expect(notify).not.toHaveBeenCalled();
  dispose();
});

test('changed embedded fields and scalar array elements publish a new snapshot', async () => {
  const { client, fetchQuery } = setup();
  const request = { viewer: { view: UserView } };
  const { viewer } = await client.request(request);
  const first = await client.readView(UserView, viewer);
  const notify = vi.fn();
  const dispose = client.store.subscribe('User:1', notify);
  fetchQuery.mockResolvedValueOnce({
    character: { color: 2 },
    id: '1',
    name: 'Sam',
    tags: ['pvp', 'story'],
  });
  await client.request(request, { mode: 'network-only' });
  const next = await client.readView(UserView, viewer);
  expect(next).not.toBe(first);
  expect(next.data).toMatchObject({ character: { color: 2 }, tags: ['pvp', 'story'] });
  expect(notify).toHaveBeenCalled();
  dispose();
});

test('scalar objects retain their own identity and are never compared by their properties', () => {
  const { client } = setup();
  const read = vi.fn(() => {
    throw new Error('Opaque scalar inspected');
  });
  const first = {
    get value() {
      return read();
    },
  };
  const second = {
    get value() {
      return read();
    },
  };
  client.write('User', { id: '1', payload: [first] }, new Set(['payload']));
  const notify = vi.fn();
  const dispose = client.store.subscribe('User:1', new Set(['payload']), notify);
  client.write('User', { id: '1', payload: [second] }, new Set(['payload']));
  expect(client.store.read('User:1')?.payload).toEqual([second]);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(read).not.toHaveBeenCalled();
  dispose();
});
