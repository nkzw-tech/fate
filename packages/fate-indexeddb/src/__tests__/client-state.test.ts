import 'fake-indexeddb/auto';
import { clientSchema, createClient, dataView, list, view, type EntityOf } from '@nkzw/fate';
import { createPersistence, type PersistenceStorage } from '@nkzw/fate/persistence';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { createIndexedDBStorage } from '../index.ts';

beforeEach(() => {
  const locks = new Map<string, Promise<unknown>>();
  vi.stubGlobal('navigator', {
    locks: {
      request<T>(key: string, run: () => Promise<T>) {
        const next = (locks.get(key) ?? Promise.resolve()).then(run);
        locks.set(
          key,
          next.catch(() => {}),
        );
        return next;
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

type Task = { id: string; title: string };
const task = dataView<Task>('Task')({ id: true, title: true });
const workspace = dataView<{ count: number; id: string; tasks: Array<Task> }>('Workspace')({
  count: true,
  id: true,
  tasks: list(task),
});
const schema = clientSchema({
  roots: { workspace: { id: 'main', type: 'Workspace' } },
  types: {
    Task: { defaults: (id) => ({ id, title: '' }), view: task },
    Workspace: {
      defaults: (id) => ({ count: 0, id, tasks: [{ id: 'seed', title: 'Seed' }] }),
      view: workspace,
    },
  },
});
const app = (storage: PersistenceStorage, key = 'tasks') =>
  createClient({
    persistence: createPersistence({ key, maxAge: 0, storage }),
  }).registerClientSchema(schema, ({ mutation }) => ({
    add: mutation('Task', {
      resolve: ({ store }) => {
        const task = store.create('Task', { id: 'new', title: 'Saved' });
        store.update('Workspace', 'main', {
          tasks: [...store.get('Workspace', 'main')!.tasks!, task],
        });
        return task;
      },
    }),
    increment: mutation('Workspace', {
      resolve: ({ store }) =>
        store.update('Workspace', 'main', {
          count: store.get('Workspace', 'main')!.count! + 1,
        }),
    }),
    removeSeed: mutation('Task', {
      resolve: ({ store }) => store.delete('Task', 'seed'),
    }),
  }));

const WorkspaceView = view<EntityOf<ReturnType<typeof app>, 'Workspace'>>()({
  count: true,
  tasks: { id: true, title: true },
});

test('restores a client graph across reloads and keeps it independent of the read cache', async () => {
  const name = crypto.randomUUID();
  const first = app(createIndexedDBStorage({ name }));
  const second = app(createIndexedDBStorage({ name }));
  try {
    await first.mutations.add();
    await first.mutations.removeSeed();
    await Promise.all([first.mutations.increment(), second.mutations.increment()]);
    await first.mutations.increment({ persist: false });
    await first.persistence!.clearCache();
  } finally {
    await Promise.all([first.persistence!.ready, second.persistence!.ready]);
    first.persistence!.dispose();
    second.persistence!.dispose();
  }
  const reopened = app(createIndexedDBStorage({ name }));
  const isolated = app(createIndexedDBStorage({ name }), 'other');
  try {
    // A request issued before restoration reads the saved data on its first result.
    const { workspace } = await reopened.request({ workspace: { view: WorkspaceView } });
    expect((await reopened.readView(WorkspaceView, workspace)).data).toMatchObject({
      count: 2,
      tasks: [{ id: 'new', title: 'Saved' }],
    });
    expect(reopened.store.read('Task:seed')).toBeUndefined();
    await isolated.persistence!.ready;
    expect(isolated.store.read('Workspace:main')?.count).toBe(0);
  } finally {
    reopened.persistence!.dispose();
    isolated.persistence!.dispose();
  }
});

test('extension fields survive reload and refetch without retaining server fields', async () => {
  const storage = createIndexedDBStorage({ name: crypto.randomUUID() });
  const make = (title: string) =>
    createClient({
      persistence: createPersistence({ key: 'posts', maxAge: 0, storage }),
      transport: { fetchById: async () => [{ id: 'p1', title }] },
      types: [{ type: 'Post' }],
    }).registerClientSchema(
      clientSchema({
        typeExtensions: {
          Post: {
            defaults: () => ({ bookmarked: false }),
            view: dataView<{ bookmarked: boolean }>('Post')({ bookmarked: true }),
          },
        },
      }),
      ({ mutation }) => ({
        bookmark: mutation('Post', {
          resolve: ({ store }) => store.update('Post', 'p1', { bookmarked: true }),
        }),
      }),
    );

  const first = make('Old title');
  await first.persistence!.ready;
  first.write('Post', { id: 'p1', title: 'Old title' }, new Set(['id', 'title']));
  await first.mutations.bookmark();
  await first.persistence!.clearCache();
  first.persistence!.dispose();

  const reopened = make('Fresh title');
  try {
    await reopened.persistence!.ready;
    expect(reopened.store.read('Post:p1')).toMatchObject({ bookmarked: true });
    expect(reopened.store.read('Post:p1')?.title).toBeUndefined();
    reopened.gc();
    const PostView = view<{ __typename: 'Post'; bookmarked: boolean; title: string }>()({
      bookmarked: true,
      title: true,
    });
    const ref = reopened.ref('Post', 'p1', PostView);
    expect((await reopened.readView(PostView, ref)).data).toMatchObject({
      bookmarked: true,
      title: 'Fresh title',
    });
  } finally {
    reopened.persistence!.dispose();
  }
});

test('initializing a refetched parent preserves its restored client children', async () => {
  const storage = createIndexedDBStorage({ name: crypto.randomUUID() });
  const note = dataView<{ id: string; title: string }>('Note')({ id: true, title: true });
  const schema = clientSchema({
    typeExtensions: {
      Post: {
        defaults: () => ({ note: { id: 'n1', title: 'Default' } }),
        view: dataView<{ note: { id: string; title: string } }>('Post')({ note }),
      },
    },
    types: { Note: { defaults: (id) => ({ id, title: '' }), view: note } },
  });
  const make = () =>
    createClient({
      persistence: createPersistence({ key: 'notes', maxAge: 0, storage }),
      transport: { fetchById: async () => [{ id: 'p1' }] },
      types: [{ type: 'Post' }],
    }).registerClientSchema(schema, ({ mutation }) => ({
      saveNote: mutation('Note', {
        resolve: ({ store }) => store.create('Note', { id: 'n1', title: 'Saved' }),
      }),
    }));

  const first = make();
  try {
    await first.mutations.saveNote();
    await first.persistence!.clearCache();
  } finally {
    first.persistence!.dispose();
  }

  const reopened = make();
  try {
    await reopened.persistence!.ready;
    expect(reopened.store.read('Note:n1')?.title).toBe('Saved');
    expect(reopened.store.read('Post:p1')).toBeUndefined();
    const PostView = view<EntityOf<typeof reopened, 'Post'>>()({ note: { title: true } });
    const ref = reopened.ref('Post', 'p1', PostView);
    expect((await reopened.readView(PostView, ref)).data.note.title).toBe('Saved');
  } finally {
    reopened.persistence!.dispose();
  }
});

test('a local mutation only reports success after its IndexedDB write commits', async () => {
  const storage = createIndexedDBStorage({ name: crypto.randomUUID() });
  const writing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let blockWrite = false;
  const client = app({
    ...storage,
    async writeBatch(entries) {
      if (blockWrite && entries.some(([key]) => key.includes('client-state-v2'))) {
        writing.resolve();
        await release.promise;
      }
      await storage.writeBatch(entries);
    },
  });
  try {
    await client.mutations.increment();
    const subscriber = vi.fn();
    client.store.subscribe('Workspace:main', subscriber);
    blockWrite = true;
    const pending = client.mutations.increment();
    const settled = vi.fn();
    const outcome = pending.then(settled, settled);
    await writing.promise;
    expect(settled).not.toHaveBeenCalled();
    expect(client.store.read('Workspace:main')?.count).toBe(1);
    expect(subscriber).not.toHaveBeenCalled();
    release.reject(new Error('Disk write failed'));
    await expect(pending).rejects.toThrow('Disk write failed');
    await outcome;
    expect(client.store.read('Workspace:main')?.count).toBe(1);
    expect(subscriber).not.toHaveBeenCalled();

    blockWrite = false;
    await client.mutations.increment();
    expect(client.store.read('Workspace:main')?.count).toBe(2);
    expect(subscriber).toHaveBeenCalledOnce();

    const reopened = app(storage);
    try {
      await reopened.persistence!.ready;
      expect(reopened.store.read('Workspace:main')?.count).toBe(2);
    } finally {
      reopened.persistence!.dispose();
    }
  } finally {
    client.persistence!.dispose();
  }
});

test('a later save starts from the latest committed state after a failed graph change', async () => {
  const storage = createIndexedDBStorage({ name: crypto.randomUUID() });
  const writeBatch = vi.spyOn(storage, 'writeBatch');
  const first = app(storage);
  const second = app(storage);
  try {
    await Promise.all([first.persistence!.ready, second.persistence!.ready]);
    await first.mutations.increment();

    writeBatch.mockRejectedValueOnce(new Error('Disk write failed'));
    await expect(first.mutations.add()).rejects.toThrow('Disk write failed');
    writeBatch.mockRejectedValueOnce(new Error('Disk write failed again'));
    await expect(first.mutations.removeSeed()).rejects.toThrow('Disk write failed again');

    // A later mutation must keep another tab's edit without saving failed writes.
    await second.mutations.increment();
    await first.mutations.removeSeed();
    const reopened = app(storage);
    try {
      const { workspace } = await reopened.request({ workspace: { view: WorkspaceView } });
      expect((await reopened.readView(WorkspaceView, workspace)).data).toMatchObject({
        count: 2,
        tasks: [],
      });
      expect(reopened.store.read('Task:seed')).toBeUndefined();
      expect(reopened.store.read('Task:new')).toBeUndefined();

      // A successful commit clears the retry state, so a no-op needs no write.
      const writes = writeBatch.mock.calls.length;
      await first.mutations.removeSeed();
      expect(writeBatch.mock.calls).toHaveLength(writes);
    } finally {
      reopened.persistence!.dispose();
    }
  } finally {
    first.persistence!.dispose();
    second.persistence!.dispose();
  }
});
