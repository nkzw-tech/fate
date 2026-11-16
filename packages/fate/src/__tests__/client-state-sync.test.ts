import { expect, test, vi } from 'vite-plus/test';
import { clientSchema, type EntityOf } from '../client-schema.ts';
import { createClient } from '../client.ts';
import { dataView } from '../data-view.ts';
import { createPersistence, type PersistenceStorage } from '../persistence.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

const schema = clientSchema({
  roots: { settings: { id: 'main', type: 'Settings' } },
  types: {
    Settings: {
      defaults: (id) => ({ count: 0, draft: '', id }),
      view: dataView<{ count: number; draft: string; id: string }>('Settings')({
        count: true,
        draft: true,
        id: true,
      }),
    },
  },
});

const app = (storage: PersistenceStorage, key = 'sync') =>
  createClient({ persistence: createPersistence({ key, storage }) }).registerClientSchema(
    schema,
    ({ mutation }) => ({
      draft: mutation('Settings', {
        resolve: ({ store }) => store.patch('Settings', 'main', { draft: 'Local only' }),
      }),
      increment: mutation('Settings', {
        resolve: ({ store }) =>
          store.patch('Settings', 'main', {
            count: store.get('Settings', 'main', ['count'])!.count! + 1,
          }),
      }),
    }),
  );

const SettingsView = view<EntityOf<ReturnType<typeof app>, 'Settings'>>()({
  count: true,
  draft: true,
});
const request = { settings: { view: SettingsView } };

test('notifies an idle reader of saved client state without overwriting memory-only fields or other accounts', async () => {
  const storage = memoryStorage();
  const writer = app(storage);
  const reader = app(storage);
  const isolated = app(storage, 'other-account');
  const observer = reader.observeRequestResult(request);
  const changed = vi.fn();
  const unsubscribe = observer.subscribe(changed);
  try {
    await Promise.all([
      writer.persistence!.ready,
      reader.request(request),
      isolated.request(request),
    ]);
    await reader.mutations.draft({ persist: false });
    changed.mockClear();

    await writer.mutations.increment();
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    expect(reader.peekView(SettingsView, observer.getSnapshot().settings)?.data).toMatchObject({
      count: 1,
      draft: 'Local only',
    });
    expect(isolated.store.read('Settings:main')?.count).toBe(0);

    changed.mockClear();
    await writer.mutations.increment();
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    expect(reader.store.read('Settings:main')).toMatchObject({ count: 2, draft: 'Local only' });
  } finally {
    unsubscribe();
    writer.persistence!.dispose();
    reader.persistence!.dispose();
    isolated.persistence!.dispose();
  }
});

test('disposes client-state subscriptions and ignores queued updates after disposal', async () => {
  const storage = memoryStorage();
  const writer = app(storage);
  const active = new Map<string, () => void>();
  const read = vi.fn(storage.read);
  const reader = app({
    ...storage,
    read,
    subscribe(key, listener) {
      active.set(key, listener);
      const unsubscribe = storage.subscribe!(key, listener);
      return () => {
        active.delete(key);
        unsubscribe();
      };
    },
  });
  try {
    await Promise.all([writer.persistence!.ready, reader.persistence!.ready]);
    const changed = active.get(JSON.stringify(['sync', 'client-state-v2']));
    expect(changed).toBeDefined();
    read.mockClear();
    reader.persistence!.dispose();
    expect(active.size).toBe(0);
    changed!();
    await writer.mutations.increment();
    expect(read).not.toHaveBeenCalled();
    expect(reader.store.read('Settings:main')?.count).toBe(0);
    expect(reader.persistence!.getSnapshot()).toMatchObject({ status: 'disposed' });
  } finally {
    writer.persistence!.dispose();
    reader.persistence!.dispose();
  }
});

test('does not miss a commit between its initial client-state read and becoming ready', async () => {
  const storage = memoryStorage();
  const writer = app(storage);
  await writer.persistence!.ready;
  const loaded = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let pause = true;
  const reader = app({
    ...storage,
    async exclusive(key, run) {
      const result = await storage.exclusive(key, run);
      if (key === JSON.stringify(['sync', 'client-state-v2']) && pause) {
        pause = false;
        loaded.resolve();
        await release.promise;
      }
      return result;
    },
  });
  try {
    await loaded.promise;
    await writer.mutations.increment();
    release.resolve();
    await reader.persistence!.ready;
    await vi.waitFor(() => expect(reader.store.read('Settings:main')?.count).toBe(1));
  } finally {
    release.resolve();
    writer.persistence!.dispose();
    reader.persistence!.dispose();
  }
});

test('removes its early subscription if initial client-state restoration fails', async () => {
  const storage = memoryStorage();
  const unsubscribe = vi.fn();
  const reader = app({
    ...storage,
    async read(key) {
      if (key === JSON.stringify(['sync', 'client-state-v2'])) {
        throw new Error('Storage unavailable');
      }
      return storage.read(key);
    },
    subscribe: () => unsubscribe,
  });
  try {
    await expect(reader.persistence!.ready).rejects.toThrow('Storage unavailable');
    expect(unsubscribe).toHaveBeenCalledOnce();
    reader.persistence!.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  } finally {
    reader.persistence!.dispose();
  }
});
