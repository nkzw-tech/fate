import { expect, test, vi } from 'vite-plus/test';
import { alias } from '../alias.ts';
import { createClient } from '../client.ts';
import { createPersistence } from '../persistence.ts';
import { clientRoot } from '../root.ts';
import { getSelectionPlan } from '../selection.ts';
import type { SelectionOf } from '../types.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

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

test('partial embedded writes preserve aliased argument variants', async () => {
  const { client } = setup();
  const English = view<User>()({
    character: { shade: alias('color', { args: { locale: 'en' } }), unitId: true },
  });
  const Japanese = view<User>()({
    character: { shade: alias('color', { args: { locale: 'ja' } }) },
  });
  const englishPlan = getSelectionPlan(English, null);
  const japanesePlan = getSelectionPlan(Japanese, null);
  client.write(
    'User',
    { character: { 'shade:color': 1, unitId: 42 }, id: '1' },
    englishPlan.paths,
    englishPlan,
  );
  client.write(
    'User',
    { character: { 'shade:color': 2 }, id: '1' },
    japanesePlan.paths,
    japanesePlan,
  );
  expect((await client.readView(English, client.ref('User', '1', English))).data).toMatchObject({
    character: { shade: 1, unitId: 42 },
  });
  expect((await client.readView(Japanese, client.ref('User', '1', Japanese))).data).toMatchObject({
    character: { shade: 2 },
  });
});

test('a stale embedded response cannot overwrite a newer partial write', async () => {
  const { client, fetchQuery } = setup();
  await client.request({ viewer: { view: Full } });
  const pending = Promise.withResolvers<object>();
  fetchQuery.mockReturnValueOnce(pending.promise);
  const refresh = client.request({ viewer: { view: Full } }, { mode: 'network-only' });
  await vi.waitFor(() => expect(fetchQuery).toHaveBeenCalledTimes(2));
  client.write('User', { character: { color: 5 }, id: '1' }, new Set(['character.color']));
  pending.resolve({ character: { color: 0, unitId: 0 }, id: '1' });
  await refresh;
  expect(client.store.read('User:1')?.character).toEqual({ ...initial.character, color: 5 });
});

test('embedded normalization preserves prototype-named own fields as data', () => {
  const { client } = setup();
  const character = JSON.parse('{"__proto__":{"color":99},"color":1}');
  client.write('User', { character, id: '1' }, new Set(['character.color']));
  const stored = client.store.read('User:1')?.character;
  expect(Object.getPrototypeOf(stored)).toBe(Object.prototype);
  expect(Object.getOwnPropertyDescriptor(stored, '__proto__')?.value).toEqual({ color: 99 });
  expect(stored).toMatchObject({ color: 1 });
});

test('normalized records keep prototype-named fields through optimistic writes', () => {
  const { client } = setup();
  const initial = JSON.parse('{"__proto__":{"color":1},"constructor":"initial","id":"1"}');
  const paths = new Set(['__proto__', 'constructor', 'id']);
  client.write('User', initial, paths);
  expect(Object.getPrototypeOf(client.store.read('User:1'))).toBe(Object.prototype);
  const settle = client.store.optimisticUpdate(() =>
    client.write(
      'User',
      JSON.parse('{"__proto__":{"color":2},"constructor":"optimistic","id":"1"}'),
      paths,
    ),
  );
  expect(client.store.read('User:1')).toEqual(
    JSON.parse('{"__proto__":{"color":2},"constructor":"optimistic","id":"1"}'),
  );
  settle();
  expect(client.store.read('User:1')).toEqual(initial);
  expect(Object.getPrototypeOf(client.store.read('User:1'))).toBe(Object.prototype);
});

test('omitted prototype-named embedded fields become undefined without inheriting values', () => {
  const { client } = setup();
  client.write(
    'User',
    { character: {}, id: '1' },
    new Set(['character.__proto__', 'character.constructor', 'character.toString']),
  );
  const character = client.store.read('User:1')?.character as Record<string, unknown>;
  expect(Object.getPrototypeOf(character)).toBe(Object.prototype);
  for (const key of ['__proto__', 'constructor', 'toString']) {
    expect(Object.hasOwn(character, key)).toBe(true);
    expect(character[key]).toBeUndefined();
  }
});

test.each(
  [false, true].flatMap((refresh) =>
    [false, true].map((referencesChanged) => ({ referencesChanged, refresh })),
  ),
)(
  'embedded replacement coverage stays removed after persistence restarts (refresh: $refresh, references: $referencesChanged)',
  async ({ referencesChanged, refresh }) => {
    type Profile = {
      __typename: 'User';
      characters: Array<{ __typename: 'Character'; color: number; unitId: number }>;
      friend: Profile;
      id: string;
      name: string;
    };
    const Full = view<Profile>()({
      characters: { color: true, unitId: true },
      friend: { id: true },
      id: true,
      name: true,
    });
    const Partial = view<Profile>()({
      characters: { color: true },
      friend: { id: true },
      id: true,
    });
    const Name = view<Profile>()({ name: true });
    const storage = memoryStorage();
    const fetchQuery = vi.fn(
      async () =>
        ({
          characters: [{ color: 1, unitId: 42 }],
          friend: { id: '2' },
          id: '1',
          name: 'Sam',
        }) as object,
    );
    const setup = () =>
      createClient({
        persistence: createPersistence({ key: 'embedded-coverage', online: () => false, storage }),
        roots: { user: clientRoot<Profile, 'User'>('User') },
        transport: { fetchById: async () => [], fetchQuery },
        types: [
          {
            fields: { characters: { embedded: 'Character' }, friend: { type: 'User' } },
            type: 'User',
          },
        ],
      });
    const first = setup();
    try {
      await first.request({ user: { view: Full } });
      await first.persistence!.flush();
      const replacement = {
        characters: [{ color: 2 }],
        friend: { id: referencesChanged ? '3' : '2' },
        id: '1',
      };
      if (refresh) {
        fetchQuery.mockResolvedValueOnce(replacement);
        await first.request({ user: { view: Partial } }, { mode: 'network-only' });
      } else {
        first.write('User', replacement, new Set(['characters.color', 'friend.id']));
      }
      expect(first.store.missingForSelection('User:1', ['characters.unitId'])).toEqual(
        new Set(['characters.unitId']),
      );
      await first.persistence!.flush();
    } finally {
      first.persistence!.dispose();
    }
    fetchQuery.mockClear();
    fetchQuery.mockRejectedValue(new Error('Offline'));
    const restored = setup();
    try {
      await restored.request({ user: { view: Partial } });
      expect(restored.store.read('User:1')?.characters).toEqual([{ color: 2 }]);
      expect(restored.store.missingForSelection('User:1', ['characters.unitId'])).toEqual(
        new Set(['characters.unitId']),
      );
      await restored.request({ user: { view: Name } });
      expect(restored.store.read('User:1')?.name).toBe('Sam');
      expect(fetchQuery).not.toHaveBeenCalled();
      await expect(restored.request({ user: { view: Full } })).rejects.toThrow('Offline');
    } finally {
      restored.persistence!.dispose();
    }
  },
);

test('view results preserve own prototype-named fields without changing their prototype', async () => {
  type PrototypeUser = {
    __proto__: { color: number };
    __typename: 'User';
    constructor: string;
    id: string;
    toString: string;
  };
  const Selected = view<PrototypeUser>()({
    ['__proto__']: { color: true },
    constructor: true,
    toString: true,
  });
  const client = createClient({
    roots: {},
    transport: { fetchById: async () => [] },
    types: [{ fields: { ['__proto__']: { embedded: 'Character' } }, type: 'User' }],
  });
  const plan = getSelectionPlan(Selected, null);
  client.write(
    'User',
    JSON.parse('{"id":"1","__proto__":{"color":3},"constructor":"data","toString":"text"}'),
    plan.paths,
    plan,
  );
  const { data } = await client.readView<
    PrototypeUser,
    SelectionOf<typeof Selected>,
    typeof Selected
  >(Selected, client.ref('User', '1', Selected));
  expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
  for (const key of ['__proto__', 'constructor', 'toString']) {
    expect(Object.hasOwn(data, key)).toBe(true);
  }
  expect(data.__proto__).toEqual({ color: 3 });
  expect(data.constructor).toBe('data');
  expect(data.toString).toBe('text');

  client.write('User', { id: '2' }, plan.paths, plan);
  const missing = (
    await client.readView<PrototypeUser, SelectionOf<typeof Selected>, typeof Selected>(
      Selected,
      client.ref('User', '2', Selected),
    )
  ).data;
  expect(Object.getPrototypeOf(missing)).toBe(Object.prototype);
  expect(missing.__proto__).toBeNull();
  expect(missing.constructor).toBeUndefined();
  expect(missing.toString).toBeUndefined();
});
