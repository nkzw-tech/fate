import { expect, test, vi } from 'vite-plus/test';
import { createNodeRef } from '../node-ref.ts';
import { createClientStateFixture } from './fixtures/client-state.ts';

test('a client mutation removes a batch and publishes only the complete parent state', async () => {
  const { make, seed } = createClientStateFixture(100);
  const client = make();
  seed(client);
  const listener = vi.fn(() => expect(client.store.read('State:main')?.items).toEqual([]));
  const stop = client.store.subscribe('State:main', listener);
  await client.mutations.removeAll();
  expect(listener).toHaveBeenCalledOnce();
  expect(client.store.read('Item:99')).toBeUndefined();
  stop();
});

test('staged writes preserve delete, recreate, relink and delete ordering', () => {
  const { make, seed } = createClientStateFixture(3);
  const client = make();
  seed(client);
  client.store.update(() =>
    client.writeClientRecords([
      { data: null, id: 'Item:0' },
      { data: null, id: 'Item:1' },
      { data: { id: '0', title: 'Recreated' }, id: 'Item:0' },
      { append: { field: 'items', members: new Set(['Item:0']) }, id: 'State:main' },
      { data: null, id: 'Item:2' },
    ]),
  );
  expect(client.store.read('State:main')?.items).toEqual([createNodeRef('Item:0')]);
  expect(client.store.read('Item:0')?.title).toBe('Recreated');
  expect(client.store.read('Item:1')).toBeUndefined();
  expect(client.store.read('Item:2')).toBeUndefined();
});
