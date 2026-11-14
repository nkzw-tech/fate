import { expect, test, vi } from 'vite-plus/test';
import { clientSchema } from '../client-schema.ts';
import { createClient } from '../client.ts';
import { dataView, list } from '../data-view.ts';
import { createPersistence } from '../persistence.ts';
import { memoryStorage } from './persistenceStorage.ts';

const key = JSON.stringify(['deltas', 'client-state-v2']);
const setup = () => {
  const storage = memoryStorage();
  // Reconciliation must work even if a suspended tab missed all notifications.
  storage.subscribe = undefined;
  const document = dataView<{ id: string; text: string }>('Document')({ id: true, text: true });
  const schema = clientSchema({
    roots: { settings: { id: 'main', type: 'Settings' } },
    types: {
      Document: { defaults: (id) => ({ id, text: '' }), view: document },
      Settings: {
        defaults: (id) => ({ count: 0, draft: '', id, items: [] }),
        view: dataView<{
          count: number;
          draft: string;
          id: string;
          items: Array<{ id: string; text: string }>;
        }>('Settings')({ count: true, draft: true, id: true, items: list(document) }),
      },
    },
  });
  const make = () =>
    createClient({
      persistence: createPersistence({ key: 'deltas', storage }),
    }).registerClientSchema(schema, ({ mutation }) => ({
      draft: mutation('Settings', {
        resolve: ({ store }) => store.patch('Settings', 'main', { draft: 'Local only' }),
      }),
      edit: mutation('Document', {
        resolve: ({ store }) => {
          store.patch('Document', '0', { text: 'Changed' });
          store.patch('Settings', 'main', { count: 10 });
        },
      }),
      increment: mutation('Settings', {
        resolve: ({ store }) =>
          store.patch('Settings', 'main', {
            count: store.get('Settings', 'main', ['count'])!.count! + 1,
          }),
      }),
      remove: mutation('Document', { resolve: ({ store }) => store.delete('Document', '0') }),
      seed: mutation('Document', {
        resolve: ({ store }) => {
          for (let id = 0; id < 100; id++) {
            store.create('Document', { id: String(id), text: `Document ${id}` });
          }
          store.append('Settings', 'main', 'items', '0', '1');
        },
      }),
    }));
  return { make, storage };
};

test('cross-tab updates read only changed entries and preserve memory-only fields', async () => {
  const { make, storage } = setup();
  const first = make();
  await first.persistence!.ready;
  await first.mutations.seed();
  const second = make();
  await second.persistence!.ready;
  try {
    await second.mutations.draft({ persist: false });
    await first.mutations.edit();
    const read = vi.spyOn(storage, 'read');
    const scan = vi.spyOn(storage, 'scan');
    await second.mutations.increment();
    expect(second.store.read('Settings:main')).toMatchObject({ count: 11, draft: 'Local only' });
    expect(second.store.read('Document:0')?.text).toBe('Changed');
    expect(scan.mock.calls.filter(([prefix]) => prefix === `${key}:`)).toHaveLength(0);
    const records = read.mock.calls
      .map(([key]) => key)
      .filter((value) => value.startsWith(`${key}:`));
    expect(records).toEqual(
      expect.arrayContaining([
        `${key}:["records","Document:0"]`,
        `${key}:["records","Settings:main"]`,
      ]),
    );
    expect(records.some((value) => value.includes('Document:99'))).toBe(false);
    const reopened = make();
    try {
      await reopened.persistence!.ready;
      expect(reopened.store.read('Settings:main')).toMatchObject({ count: 11, draft: '' });
    } finally {
      reopened.persistence!.dispose();
    }
  } finally {
    first.persistence!.dispose();
    second.persistence!.dispose();
  }
});

test.each(['gap', 'legacy', 'malformed'] as const)(
  'falls back to a complete restore after %s history',
  async (mode) => {
    const { make, storage } = setup();
    const first = make();
    await first.persistence!.ready;
    await first.mutations.seed();
    const second = make();
    await second.persistence!.ready;
    try {
      const count = mode === 'gap' ? 20 : 1;
      for (let i = 0; i < count; i++) {
        await first.mutations.increment();
      }
      const header = (await storage.read(key)) as any;
      expect(header.history.batches.length).toBeLessThanOrEqual(16);
      if (mode !== 'gap') {
        if (mode === 'legacy') {
          delete header.history;
        } else {
          header.history.batches[0].entries = [['invalid', 'id']];
        }
        await storage.writeBatch([[key, header]]);
      }
      const scan = vi.spyOn(storage, 'scan');
      await second.mutations.increment();
      expect(second.store.read('Settings:main')?.count).toBe(count + 1);
      expect(scan.mock.calls.some(([prefix]) => prefix === `${key}:`)).toBe(true);
    } finally {
      first.persistence!.dispose();
      second.persistence!.dispose();
    }
  },
);

test('delta restoration applies record deletions and relationship membership together', async () => {
  const { make } = setup();
  const first = make();
  await first.persistence!.ready;
  await first.mutations.seed();
  const second = make();
  await second.persistence!.ready;
  try {
    await first.mutations.remove();
    await second.mutations.increment();
    expect(second.store.read('Document:0')).toBeUndefined();
    const reopened = make();
    try {
      await reopened.persistence!.ready;
      expect(second.store.read('Settings:main')?.items).toEqual(
        reopened.store.read('Settings:main')?.items,
      );
      expect(reopened.store.read('Document:0')).toBeUndefined();
    } finally {
      reopened.persistence!.dispose();
    }
  } finally {
    first.persistence!.dispose();
    second.persistence!.dispose();
  }
});

test('a corrupt delta publishes no partial state and can be retried', async () => {
  const { make, storage } = setup();
  const first = make();
  await first.persistence!.ready;
  await first.mutations.seed();
  const second = make();
  await second.persistence!.ready;
  try {
    await first.mutations.edit();
    storage.readMany = async (keys) => {
      const values = await Promise.all(keys.map((key) => storage.read(key)));
      values[values.length - 1] = { bytes: 0, data: null };
      return values;
    };
    await expect(second.mutations.increment()).rejects.toThrow('Invalid persisted client state');
    expect(second.store.read('Settings:main')?.count).toBe(0);
    expect(second.store.read('Document:0')?.text).toBe('Document 0');
    storage.readMany = undefined;
    await second.mutations.increment();
    expect(second.store.read('Settings:main')?.count).toBe(11);
    expect(second.store.read('Document:0')?.text).toBe('Changed');
  } finally {
    first.persistence!.dispose();
    second.persistence!.dispose();
  }
});
