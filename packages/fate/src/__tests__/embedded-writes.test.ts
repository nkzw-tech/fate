import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { clientRoot } from '../root.ts';
import type { SelectionOf } from '../types.ts';
import { view } from '../view.ts';

type User = {
  __typename: 'User';
  character: { color: number; detail: { level: number; name: string }; unitId: number } | null;
  id: string;
};
const Full = view<User>()({
  character: { color: true, detail: { level: true, name: true }, unitId: true },
  id: true,
});
const Partial = view<User>()({ character: { color: true, detail: { name: true } }, id: true });
const initial = { character: { color: 1, detail: { level: 3, name: 'Sam' }, unitId: 42 }, id: '1' };
const setup = () => {
  const fetchQuery = vi.fn(async () => initial as object);
  const client = createClient({
    roots: { viewer: clientRoot<User, 'User'>('User') },
    transport: { fetchById: async () => [], fetchQuery },
    types: [{ fields: { character: { embedded: 'Character' } }, type: 'User' }],
  });
  return { client, fetchQuery };
};

test('partial embedded responses preserve cached siblings recursively', async () => {
  const { client, fetchQuery } = setup();
  const { viewer } = await client.request({ viewer: { view: Full } });
  fetchQuery.mockResolvedValueOnce({
    character: { color: 2, detail: { name: 'Maxima' } },
    id: '1',
  });
  await client.request({ viewer: { view: Partial } }, { mode: 'network-only' });
  expect(
    (await client.readView<User, SelectionOf<typeof Full>, typeof Full>(Full, viewer)).data
      .character,
  ).toEqual({
    color: 2,
    detail: { level: 3, name: 'Maxima' },
    unitId: 42,
  });
  expect(fetchQuery).toHaveBeenCalledTimes(2);
});

test('selected omitted embedded fields overwrite previous values with undefined', async () => {
  const { client, fetchQuery } = setup();
  const { viewer } = await client.request({ viewer: { view: Full } });
  fetchQuery.mockResolvedValueOnce({ character: { detail: { name: 'Maxima' } }, id: '1' });
  await client.request({ viewer: { view: Partial } }, { mode: 'network-only' });
  expect(
    (await client.readView<User, SelectionOf<typeof Full>, typeof Full>(Full, viewer)).data
      .character,
  ).toEqual({
    color: undefined,
    detail: { level: 3, name: 'Maxima' },
    unitId: 42,
  });
});

test('replacing an embedded object with null discards coverage for its old siblings', async () => {
  const { client, fetchQuery } = setup();
  await client.request({ viewer: { view: Full } });
  fetchQuery.mockResolvedValueOnce({ character: null, id: '1' });
  await client.request({ viewer: { view: Partial } }, { mode: 'network-only' });
  fetchQuery.mockResolvedValueOnce({
    character: { color: 2, detail: { name: 'Maxima' } },
    id: '1',
  });
  await client.request({ viewer: { view: Partial } }, { mode: 'network-only' });
  expect(
    client.store.missingForSelection('User:1', ['character.unitId', 'character.detail.level']),
  ).toEqual(new Set(['character.unitId', 'character.detail.level']));
});

test('optimistic embedded edits rebase over server siblings and restore on failure', async () => {
  const { client } = setup();
  await client.request({ viewer: { view: Full } });
  const settle = client.store.optimisticUpdate(() =>
    client.write('User', { character: { color: 5 }, id: '1' }, new Set(['id', 'character.color'])),
  );
  client.write('User', { character: { unitId: 99 }, id: '1' }, new Set(['id', 'character.unitId']));
  expect(client.store.read('User:1')?.character).toEqual({
    ...initial.character,
    color: 5,
    unitId: 99,
  });
  settle();
  expect(client.store.read('User:1')?.character).toEqual({ ...initial.character, unitId: 99 });
});

test('embedded arrays replace their elements and discard previous element coverage', () => {
  const client = createClient({
    roots: {},
    transport: { fetchById: async () => [] },
    types: [{ fields: { characters: { embedded: 'Character' } }, type: 'User' }],
  });
  client.write(
    'User',
    { characters: [{ color: 1, unitId: 42 }], id: '1' },
    new Set(['characters.color', 'characters.unitId']),
  );
  client.write('User', { characters: [{ color: 2 }], id: '1' }, new Set(['characters.color']));
  expect(client.store.read('User:1')?.characters).toEqual([{ color: 2 }]);
  expect(client.store.missingForSelection('User:1', ['characters.unitId'])).toEqual(
    new Set(['characters.unitId']),
  );
});

test('partial embedded writes do not inspect or merge opaque scalar fields', () => {
  const read = vi.fn(() => {
    throw new Error('Opaque scalar inspected');
  });
  const first = {
    get value() {
      return read();
    },
  };
  const second = { replacement: true };
  const client = createClient({
    roots: {},
    transport: { fetchById: async () => [] },
    types: [{ fields: { payload: 'scalar' }, type: 'User' }],
  });
  client.write('User', { id: '1', payload: first }, new Set(['payload']));
  expect(client.store.read('User:1')?.payload).toBe(first);
  client.write('User', { id: '1', payload: second }, new Set(['payload']));
  expect(client.store.read('User:1')?.payload).toBe(second);
  expect(read).not.toHaveBeenCalled();
});
