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
