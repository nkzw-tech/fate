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
test('writing fields outside a view preserves that view snapshot', async () => {
  const { client } = setup();
  const { viewer } = await client.request({ viewer: { view: UserView } });
  const first = await client.readView(UserView, viewer);
  client.write('User', { id: '1', lastLogin: 'today' }, new Set(['lastLogin']));
  expect(await client.readView(UserView, viewer)).toBe(first);
});

test('identical embedded array responses reuse elements without merging partial elements by position', () => {
  const client = createClient({
    roots: {},
    transport: { fetchById: async () => [] },
    types: [{ fields: { characters: { embedded: 'Character' } }, type: 'User' }],
  });
  const select = new Set(['characters.color', 'characters.unitId']);
  const initial = { characters: [{ color: 1, unitId: 42 }, null], id: '1' };
  client.write('User', structuredClone(initial), select);
  const first = client.store.read('User:1')?.characters;
  const notify = vi.fn();
  const dispose = client.store.subscribe('User:1', new Set(['characters']), notify);
  client.write('User', structuredClone(initial), select);
  expect(client.store.read('User:1')?.characters).toBe(first);
  expect(notify).not.toHaveBeenCalled();
  client.write(
    'User',
    { characters: [{ color: 1 }, null], id: '1' },
    new Set(['characters.color']),
  );
  expect(client.store.read('User:1')?.characters).toEqual([{ color: 1 }, null]);
  expect(notify).toHaveBeenCalledTimes(1);
  dispose();
});

test('creating a previously missing record recovers a failed view read', async () => {
  const Name = view<User>()({ name: true });
  const client = createClient({
    roots: {},
    transport: { fetchById: async () => [] },
    types: [{ type: 'User' }],
  });
  const ref = client.ref('User', '1', Name);
  await expect(client.readView(Name, ref)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  client.write('User', { id: '1', name: 'Sam' }, new Set(['name']));
  expect((await client.readView(Name, ref)).data).toMatchObject({ name: 'Sam' });
});

test('relation churn does not retain dependencies on detached children', async () => {
  type Person = { __typename: 'User'; friend: Person; id: string; name: string };
  const Parent = view<Person>()({ friend: { friend: { name: true }, id: true, name: true } });
  const client = createClient({
    roots: {},
    transport: { fetchById: async () => [] },
    types: [{ fields: { friend: { type: 'User' } }, type: 'User' }],
  });
  const ref = client.ref('User', 'parent', Parent);
  for (let index = 0; index < 100; index++) {
    client.write(
      'User',
      {
        friend: { friend: { id: `leaf-${index}`, name: 'Sam' }, id: String(index), name: 'Sam' },
        id: 'parent',
      },
      new Set(['friend.friend.name', 'friend.id', 'friend.name']),
    );
    await client.readView(Parent, ref);
  }
  const current = await client.readView(Parent, ref);
  for (let index = 0; index < 99; index++) {
    client.deleteRecord('User', String(index));
    expect(await client.readView(Parent, ref)).toBe(current);
  }
  client.write('User', { id: 'leaf-99', name: 'Leaf' }, new Set(['name']));
  const nested = await client.readView(Parent, ref);
  expect(nested).not.toBe(current);
  expect(nested.data).toMatchObject({ friend: { friend: { name: 'Leaf' } } });
  client.write('User', { id: '99', name: 'Maxima' }, new Set(['name']));
  const next = await client.readView(Parent, ref);
  expect(next).not.toBe(nested);
  expect(next.data).toMatchObject({ friend: { id: '99', name: 'Maxima' } });
});

test('parent updates preserve masked refs and unchanged inline subtrees', async () => {
  type Child = { __typename: 'Child'; id: string; name: string };
  type Parent = { __typename: 'Parent'; children: Array<Child>; count: number; id: string };
  const ChildView = view<Child>()({ name: true });
  const Masked = view<Parent>()({ children: ChildView, count: true });
  const Inline = view<Parent>()({ children: { id: true, name: true }, count: true });
  const client = createClient({
    types: [
      { fields: { children: { array: true, listOf: 'Child' } }, type: 'Parent' },
      { type: 'Child' },
    ],
  });
  client.write(
    'Parent',
    {
      children: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      count: 0,
      id: 'p',
    },
    new Set(['id', 'count', 'children.id', 'children.name']),
  );
  const maskedRef = client.ref<Parent>('Parent', 'p', Masked);
  const inlineRef = client.ref<Parent>('Parent', 'p', Inline);
  const masked = (await client.readView(Masked, maskedRef)).data;
  const inline = (await client.readView(Inline, inlineRef)).data;
  client.write('Parent', { count: 1, id: 'p' }, new Set(['count']));
  const nextMasked = (await client.readView(Masked, maskedRef)).data;
  const nextInline = (await client.readView(Inline, inlineRef)).data;
  expect(nextMasked.children).toBe(masked.children);
  expect(nextInline.children).toBe(inline.children);
  expect(nextMasked.count).toBe(1);
  client.write('Child', { id: 'a', name: 'Changed' }, new Set(['name']));
  const changed = (await client.readView(Inline, inlineRef)).data;
  expect(changed.children[0]).not.toBe(nextInline.children[0]);
  expect(changed.children[0].name).toBe('Changed');
  expect(changed.children[1]).toBe(nextInline.children[1]);
  // Canonical refs survive reordered membership too.
  client.write(
    'Parent',
    {
      children: [
        { id: 'b', name: 'B' },
        { id: 'a', name: 'Changed' },
      ],
      id: 'p',
    },
    new Set(['children.id', 'children.name']),
  );
  const reordered = (await client.readView(Masked, maskedRef)).data;
  expect(reordered.children[0]).toBe(masked.children[1]);
  expect(reordered.children[1]).toBe(masked.children[0]);
});

test('recycling selected containers does not inspect scalar objects', async () => {
  const selected = view<User>()({ name: true, tags: true });
  const client = createClient({ types: [{ type: 'User' }] });
  const ref = client.ref<User>('User', '1', selected);
  const read = vi.fn(() => {
    throw new Error('Scalar inspected');
  });
  const scalar = {
    get dangerous() {
      return read();
    },
  };
  client.write('User', { id: '1', name: 'Before', tags: scalar }, new Set(['name', 'tags']));
  await client.readView(selected, ref);
  client.write('User', { id: '1', name: 'After' }, new Set(['name']));
  expect((await client.readView(selected, ref)).data.tags).toBe(scalar);
  expect(read).not.toHaveBeenCalled();
});

test('composed views can contribute to the same child ref', async () => {
  type Child = { __typename: 'Child'; email: string; id: string; name: string };
  type Parent = { __typename: 'Parent'; child: Child; count: number; id: string };
  const Name = view<Child>()({ name: true });
  const Email = view<Child>()({ email: true });
  const First = view<Parent>()({ child: Name, count: true });
  const Second = view<Parent>()({ child: Email });
  const Combined = { ...First, ...Second };
  const client = createClient({
    types: [{ fields: { child: { type: 'Child' } }, type: 'Parent' }, { type: 'Child' }],
  });
  client.write(
    'Parent',
    { child: { email: 'sam@example.com', id: 'c', name: 'Sam' }, count: 0, id: 'p' },
    new Set(['child.email', 'child.name', 'count']),
  );
  const ref = client.ref<Parent>('Parent', 'p', Combined);
  const { data } = await client.readView(Combined, ref);
  expect((await client.readView(Name, data.child)).data.name).toBe('Sam');
  expect((await client.readView(Email, data.child)).data.email).toBe('sam@example.com');
  client.write('Parent', { count: 1, id: 'p' }, new Set(['count']));
  expect((await client.readView(Combined, ref)).data.child).toBe(data.child);
});
