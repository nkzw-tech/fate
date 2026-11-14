import { expect, test } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { readPersistenceBatch } from '../persistence-utils.ts';
import { createPersistence } from '../persistence.ts';
import { clientRoot } from '../root.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

test.each([false, true])('restores a graph with bounded reads (readMany: %s)', async (batch) => {
  const storage = memoryStorage();
  const sizes: Array<number> = [];
  let active = 0;
  let peak = 0;
  const read = storage.read;
  storage.read = async (key) => {
    peak = Math.max(peak, ++active);
    try {
      return await read(key);
    } finally {
      active--;
    }
  };
  if (batch) {
    storage.readMany = async (keys) => {
      sizes.push(keys.length);
      return Promise.all(keys.map(read));
    };
  }
  const rows = Array.from({ length: 100 }, (_, id) => ({ id: String(id), title: `Task ${id}` }));
  const selection = view<{
    __typename: 'Parent';
    id: string;
    items: Array<{ __typename: 'Item'; id: string; title: string }>;
  }>()({ items: { id: true, title: true } });
  let requests = 0;
  const make = () =>
    createClient({
      persistence: createPersistence({ key: 'batch', storage }),
      roots: { parent: clientRoot('Parent') },
      transport: {
        fetchById: async () => {
          requests++;
          return [{ id: 'main', items: rows }];
        },
      },
      types: [
        { fields: { items: { array: true, listOf: 'Item' } }, type: 'Parent' },
        { type: 'Item' },
      ],
    });
  const first = make();
  const request = { parent: { id: 'main', view: selection } };
  await first.request(request);
  await first.persistence!.flush();
  first.persistence!.dispose();
  sizes.length = 0;
  const next = make();
  try {
    await next.request(request);
    expect(requests).toBe(1);
    expect(next.store.read('Item:99')?.title).toBe('Task 99');
    if (batch) {
      expect(sizes).toEqual([1, 32, 32, 32, 4]);
    } else {
      expect(peak).toBe(32);
    }
  } finally {
    next.persistence!.dispose();
  }
});

test('fallback batch reads settle outstanding reads before surfacing a failure', async () => {
  const done = Promise.withResolvers<unknown>();
  const storage = memoryStorage();
  storage.read = (key) => (key === 'bad' ? Promise.reject(new Error('Read failed')) : done.promise);
  let settled = false;
  const pending = readPersistenceBatch(storage, ['bad', 'good']).finally(() => {
    settled = true;
  });
  const result = expect(pending).rejects.toThrow('Read failed');
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
  done.resolve(undefined);
  await result;
});

test('a short readMany result is rejected rather than treating omitted values as missing records', async () => {
  const storage = memoryStorage();
  storage.readMany = async () => [];
  await expect(readPersistenceBatch(storage, ['a'])).rejects.toThrow(
    'Invalid persistence readMany',
  );
});
