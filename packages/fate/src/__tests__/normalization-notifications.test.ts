import { expect, test } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { clientRoot } from '../root.ts';
import { view } from '../view.ts';

type Item = { __typename: 'Item'; id: string; title: string };
type Parent = { __typename: 'Parent'; id: string; items: Array<Item> };
const selection = view<Parent>()({ items: { id: true, title: true } });
const paths = new Set(['items', 'items.id', 'items.title']);

test.each(['write', 'fetch'] as const)(
  '%s publishes one complete graph to subscribed readers',
  async (mode) => {
    let title = 'Before';
    const data = () => ({ id: 'parent', items: ['a', 'b'].map((id) => ({ id, title })) });
    const client = createClient({
      roots: { parent: clientRoot<Parent, 'Parent'>('Parent') },
      transport: { fetchById: async () => [data()] },
      types: [
        { fields: { items: { array: true, listOf: 'Item' } }, type: 'Parent' },
        { type: 'Item' },
      ],
    });
    client.write('Parent', data(), paths);
    const ref = client.ref<Parent>('Parent', 'parent', selection);
    const first = await client.readView(selection, ref);
    const observed: Array<unknown> = [];
    const notify = () =>
      observed.push(client.readView(selection, ref).value?.data.items.map(({ title }) => title));
    for (const [id, fields] of first.coverage) {
      client.store.subscribe(id, fields, notify);
    }
    title = 'After';
    if (mode === 'write') {
      client.write('Parent', data(), paths);
    } else {
      await client.request({ parent: { id: 'parent', view: selection } }, { mode: 'network-only' });
    }
    expect(observed).toEqual([['After', 'After']]);
  },
);

test('a multi-ID response rebases once and retains overlapping optimistic writes until rollback', async () => {
  const itemView = view<Item>()({ id: true, title: true });
  const selected = new Set(['id', 'title']);
  const client = createClient({
    roots: { items: clientRoot<Item, 'Item'>('Item') },
    transport: {
      fetchById: async () => ['a', 'b', 'c'].map((id) => ({ id, title: `Server ${id}` })),
    },
    types: [{ type: 'Item' }],
  });
  for (const id of ['a', 'b', 'c']) {
    client.write('Item', { id, title: 'Initial' }, selected);
  }
  let applications = 0;
  const rollback = client.store.optimisticUpdate(() => {
    applications++;
    client.write('Item', { id: 'a', title: 'Optimistic' }, selected);
  });
  const observed: Array<unknown> = [];
  const notify = () =>
    observed.push(['a', 'b', 'c'].map((id) => client.store.read(`Item:${id}`)?.title));
  for (const id of ['a', 'b', 'c']) {
    client.store.subscribe(`Item:${id}`, notify);
  }
  applications = 0;
  await client.request(
    { items: { ids: ['a', 'b', 'c'], view: itemView } },
    { mode: 'network-only' },
  );
  expect(applications).toBe(1);
  expect(observed).toEqual([['Optimistic', 'Server b', 'Server c']]);
  rollback();
  expect(client.store.read('Item:a')?.title).toBe('Server a');
});
