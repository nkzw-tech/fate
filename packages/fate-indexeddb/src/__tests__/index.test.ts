import 'fake-indexeddb/auto';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { createIndexedDBStorage } from '../index.ts';

afterEach(() => vi.unstubAllGlobals());

test('committed data survives opening another adapter and isolates account keys', async () => {
  const name = crypto.randomUUID();
  const first = createIndexedDBStorage({ name });
  const value = { entries: [{ input: 'pending' }], version: 1 };
  await first.writeBatch([['account:1', value]]);
  value.entries.length = 0;
  const next = createIndexedDBStorage({ name });
  expect(await next.read('account:1')).toEqual({ entries: [{ input: 'pending' }], version: 1 });
  expect(await next.read('account:2')).toBeUndefined();
});

test('failed replacement leaves the previous durable value intact', async () => {
  const storage = createIndexedDBStorage({ name: crypto.randomUUID() });
  await storage.writeBatch([['key', { saved: true }]]);
  await expect(storage.writeBatch([['key', { invalid: () => {} }]])).rejects.toThrow();
  expect(await storage.read('key')).toEqual({ saved: true });
});

test('notifications propagate across adapter instances and unsubscribe', async () => {
  const name = crypto.randomUUID();
  const first = createIndexedDBStorage({ name });
  const second = createIndexedDBStorage({ name });
  const listener = vi.fn();
  const stopFirst = first.subscribe!('key', () => {});
  const stopSecond = second.subscribe!('key', listener);
  try {
    await first.writeBatch([['key', { value: 1 }]]);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
  } finally {
    stopFirst();
    stopSecond();
  }
});

test('uses a database-scoped Web Lock and refuses unsafe fallback', async () => {
  const request = vi.fn(async (_key: string, run: () => Promise<unknown>) => run());
  vi.stubGlobal('navigator', { locks: { request } });
  const storage = createIndexedDBStorage({ name: 'test-db' });
  await expect(storage.exclusive('account:write', async () => 42)).resolves.toBe(42);
  expect(request.mock.calls[0][0]).toBe('fate:["test-db","account:write"]');
  vi.stubGlobal('navigator', {});
  expect(() => storage.exclusive('key', async () => {})).toThrow(/Web Locks/);
});

test('bounded scans are ordered and isolated, and batches support deletion', async () => {
  const storage = createIndexedDBStorage({ name: crypto.randomUUID() });
  await storage.writeBatch([
    ['cache:c', 3],
    ['other:a', 0],
    ['cache:a', 1],
    ['cache:b', 2],
  ]);
  expect(await storage.scan('cache:', undefined, 2)).toEqual([
    { key: 'cache:a', value: 1 },
    { key: 'cache:b', value: 2 },
  ]);
  expect(await storage.scan('cache:', 'cache:b', 2)).toEqual([{ key: 'cache:c', value: 3 }]);
  await storage.writeBatch([
    ['cache:a', undefined],
    ['cache:b', 4],
  ]);
  expect(await storage.read('cache:a')).toBeUndefined();
  expect(await storage.read('cache:b')).toBe(4);
});

test('a failed batch rolls back every write', async () => {
  const storage = createIndexedDBStorage({ name: crypto.randomUUID() });
  await storage.writeBatch([['key', 'Original']]);
  await expect(
    storage.writeBatch([
      ['key', 'Changed'],
      ['invalid', () => {}],
    ]),
  ).rejects.toThrow();
  expect(await storage.read('key')).toBe('Original');
});

test('batch commits notify subscribers even when the writer has no subscription', async () => {
  const name = crypto.randomUUID();
  const writer = createIndexedDBStorage({ name });
  const reader = createIndexedDBStorage({ name });
  const listener = vi.fn();
  const stop = reader.subscribe!('key', listener);
  try {
    await writer.writeBatch([['key', 'Saved']]);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(await reader.read('key')).toBe('Saved');
  } finally {
    stop();
  }
});

test('bounded operations share one database connection while holding an exclusive lock', async () => {
  vi.stubGlobal('navigator', {
    locks: { request: async (_key: string, run: () => Promise<unknown>) => run() },
  });
  const storage = createIndexedDBStorage({ name: crypto.randomUUID() });
  const open = vi.spyOn(globalThis.indexedDB, 'open');
  try {
    await storage.exclusive('cache', async () => {
      await storage.writeBatch([['key', 'Saved']]);
      for (let index = 0; index < 10; index++) {
        expect(await storage.read('key')).toBe('Saved');
      }
    });
    expect(open).toHaveBeenCalledTimes(1);
    await storage.read('key');
    expect(open).toHaveBeenCalledTimes(2);
  } finally {
    open.mockRestore();
  }
});

test('prefix scans include the entire Unicode suffix range', async () => {
  const storage = createIndexedDBStorage({ name: crypto.randomUUID() });
  await storage.writeBatch([
    ['cache:a', 1],
    ['cache:\uffffsuffix', 2],
    ['other:a', 3],
  ]);
  expect(await storage.scan('cache:')).toEqual([
    { key: 'cache:a', value: 1 },
    { key: 'cache:\uffffsuffix', value: 2 },
  ]);
});

test('observer exceptions do not reject a successfully committed write', async () => {
  const storage = createIndexedDBStorage({ name: crypto.randomUUID() });
  const stop = storage.subscribe!('key', () => {
    throw new Error('Broken observer');
  });
  try {
    await expect(storage.writeBatch([['key', 'Saved']])).resolves.toBeUndefined();
    expect(await storage.read('key')).toBe('Saved');
  } finally {
    stop();
  }
});
