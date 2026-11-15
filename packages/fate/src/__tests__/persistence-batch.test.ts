import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { readPersistenceBatch } from '../persistence-utils.ts';
import { createPersistence } from '../persistence.ts';
import { clientRoot } from '../root.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

test('fresh exact cache hits avoid node rewrites but changed policies and missing nodes recover', async () => {
  const storage = memoryStorage();
  const fetchById = vi.fn(async () => [
    { id: '1', title: 'One' },
    { id: '2', title: 'Two' },
  ]);
  const selected = view<any>()({ title: true });
  const request = { items: { ids: ['1', '2'], view: selected } };
  const make = () =>
    createClient({
      persistence: createPersistence({ key: 'fresh', maxAge: 60_000, storage }),
      roots: { items: clientRoot('Item') },
      transport: { fetchById },
      types: [{ type: 'Item' }],
    });
  const first = make();
  await first.request(request);
  await first.persistence!.flush();
  first.persistence!.dispose();
  const next = make();
  try {
    await next.request(request);
    const write = vi.spyOn(storage, 'writeBatch');
    await next.persistence!.flush();
    const nodeWrites = () =>
      write.mock.calls.flatMap(([entries]) => entries).filter(([key]) => key.includes(':node:'));
    expect(nodeWrites()).toEqual([]);
    expect(fetchById).toHaveBeenCalledOnce();
    const rootPrefix = `${JSON.stringify(['fresh', 'cache-v2'])}:root:`;
    const before = ((await storage.scan(rootPrefix))[0].value as any).value;
    const now = vi.spyOn(Date, 'now').mockReturnValue(before.usedAt + 1000);
    try {
      // A new request handle can hit memory without restore() touching its LRU stamp.
      next.releaseRequest(request, 'cache-first');
      await next.request(request);
      await next.persistence!.flush();
      const root = ((await storage.scan(rootPrefix))[0].value as any).value;
      expect(root.usedAt).toBe(before.usedAt + 1000);
      expect(root.fetchedAt).toBe(before.fetchedAt);
      expect(nodeWrites()).toEqual([]);
    } finally {
      now.mockRestore();
    }
    await next.request(request, { persist: { maxAge: 120_000 } });
    await next.persistence!.flush();
    expect(nodeWrites().length).toBeGreaterThan(0);
    const prefix = `${JSON.stringify(['fresh', 'cache-v2'])}:`;
    const roots = await storage.scan(`${prefix}root:`);
    expect((roots[0].value as any).value.maxAge).toBe(120_000);
    // A missing claim must cause a network refresh on the next restore.
    const nodes = await storage.scan(`${prefix}node:`);
    await storage.writeBatch([[nodes[0].key, undefined]]);
    const recovered = make();
    try {
      await recovered.request(request);
      await recovered.persistence!.flush();
      expect(fetchById).toHaveBeenCalledTimes(2);
      expect(recovered.store.read('Item:2')?.title).toBe('Two');
    } finally {
      recovered.persistence!.dispose();
    }
    write.mockRestore();
  } finally {
    next.persistence!.dispose();
  }
});

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
