import { expect, test, vi } from 'vite-plus/test';
import { z } from 'zod';
import { clientSchema, type EntityOf } from '../client-schema.ts';
import { createClient } from '../client.ts';
import { dataView, list } from '../data-view.ts';
import { createPersistence } from '../persistence.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

test('saving a small record in a large graph only reads the header and writes that record', async () => {
  const storage = memoryStorage();
  const read = vi.spyOn(storage, 'read');
  const scan = vi.spyOn(storage, 'scan');
  const write = vi.spyOn(storage, 'writeBatch');
  const payload = 'x'.repeat(50_000);
  const schema = clientSchema({
    roots: { settings: { id: 'main', type: 'Settings' } },
    types: {
      Document: {
        defaults: (id) => ({ id, payload: '' }),
        view: dataView<{ id: string; payload: string }>('Document')({ id: true, payload: true }),
      },
      Settings: {
        defaults: (id) => ({ enabled: false, id }),
        view: dataView<{ enabled: boolean; id: string }>('Settings')({ enabled: true, id: true }),
      },
    },
  });
  const make = () =>
    createClient({
      persistence: createPersistence({ key: 'library', storage }),
    }).registerClientSchema(schema, ({ mutation }) => ({
      enable: mutation('Settings', {
        resolve: ({ store }) => store.update('Settings', 'main', { enabled: true }),
      }),
      importDocuments: mutation('Document', {
        resolve: ({ store }) => {
          for (let id = 0; id < 100; id++) {
            store.create('Document', { id: String(id), payload });
          }
        },
      }),
    }));
  const client = make();
  try {
    await client.mutations.importDocuments();
    const snapshot = vi.spyOn(client.store, 'dehydrateConfirmed');
    read.mockClear();
    scan.mockClear();
    write.mockClear();

    await client.mutations.enable();

    const header = JSON.stringify(['library', 'client-state-v2']);
    expect(read.mock.calls).toEqual([[header]]);
    expect(scan).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledOnce();
    const batch = write.mock.calls[0][0];
    expect(batch.map(([key]) => key)).toEqual([`${header}:["records","Settings:main"]`, header]);
    expect(JSON.stringify(batch).length).toBeLessThan(512);

    const reopened = make();
    try {
      await reopened.persistence!.ready;
      expect(reopened.store.read('Settings:main')?.enabled).toBe(true);
      expect(reopened.store.read('Document:99')?.payload).toBe(payload);
    } finally {
      reopened.persistence!.dispose();
    }
  } finally {
    client.persistence!.dispose();
  }
});

test('retrying a failed save persists the assignment without saving memory-only fields', async () => {
  const storage = memoryStorage();
  const writeBatch = vi.spyOn(storage, 'writeBatch');
  const make = () =>
    createClient({
      persistence: createPersistence({ key: 'notes', storage }),
    }).registerClientSchema(
      clientSchema({
        roots: { note: { id: 'main', type: 'Note' } },
        types: {
          Note: {
            defaults: (id) => ({ draft: '', id, title: 'Default' }),
            view: dataView<{ draft: string; id: string; title: string }>('Note')({
              draft: true,
              id: true,
              title: true,
            }),
          },
        },
      }),
      ({ mutation }) => ({
        draft: mutation('Note', {
          resolve: ({ store }) => store.update('Note', 'main', { draft: 'Only in memory' }),
        }),
        save: mutation('Note', {
          resolve: ({ store }) => store.update('Note', 'main', { title: 'Saved' }),
        }),
      }),
    );
  const client = make();
  try {
    await client.persistence!.ready;
    await client.mutations.draft({ persist: false });
    writeBatch.mockRejectedValueOnce(new Error('Disk write failed'));
    await expect(client.mutations.save()).rejects.toThrow('Disk write failed');
    expect(client.store.read('Note:main')?.title).toBe('Default');

    writeBatch.mockRejectedValueOnce(new Error('Disk write failed again'));
    await expect(client.mutations.save()).rejects.toThrow('Disk write failed again');
    await client.mutations.save();
    expect(client.store.read('Note:main')?.draft).toBe('Only in memory');
    const reopened = make();
    try {
      await reopened.persistence!.ready;
      expect(reopened.store.read('Note:main')).toMatchObject({ draft: '', title: 'Saved' });
    } finally {
      reopened.persistence!.dispose();
    }
  } finally {
    client.persistence!.dispose();
  }
});

test('a save preserves another tab’s edits without committing an earlier failed write', async () => {
  const storage = memoryStorage();
  const writeBatch = vi.spyOn(storage, 'writeBatch');
  const make = () =>
    createClient({
      persistence: createPersistence({ key: 'notes', storage }),
    }).registerClientSchema(
      clientSchema({
        roots: { note: { id: 'main', type: 'Note' } },
        types: {
          Note: {
            defaults: (id) => ({ count: 0, draft: '', id, title: 'Default' }),
            view: dataView<{ count: number; draft: string; id: string; title: string }>('Note')({
              count: true,
              draft: true,
              id: true,
              title: true,
            }),
          },
        },
      }),
      ({ mutation }) => ({
        increment: mutation('Note', {
          resolve: ({ store }) =>
            store.update('Note', 'main', { count: store.get('Note', 'main')!.count! + 1 }),
        }),
        save: mutation('Note', {
          input: z.object({ draft: z.string().optional(), title: z.string() }),
          resolve: ({ input, store }) => store.update('Note', 'main', input),
        }),
      }),
    );
  const first = make();
  const second = make();
  try {
    await Promise.all([first.persistence!.ready, second.persistence!.ready]);
    writeBatch.mockRejectedValueOnce(new Error('Disk write failed'));
    await expect(
      first.mutations.save({ input: { draft: 'Failed draft', title: 'A' } }),
    ).rejects.toThrow('Disk write failed');
    await second.mutations.save({ input: { title: 'B' } });
    await first.mutations.increment();

    const expected = { count: 1, draft: '', title: 'B' };
    expect(first.store.read('Note:main')).toMatchObject(expected);
    const reopened = make();
    try {
      await reopened.persistence!.ready;
      expect(reopened.store.read('Note:main')).toMatchObject(expected);
      await first.mutations.save({ input: { title: 'B' } });
      await reopened.mutations.increment();
      expect(reopened.store.read('Note:main')).toMatchObject({ ...expected, count: 2 });
    } finally {
      reopened.persistence!.dispose();
    }
  } finally {
    first.persistence!.dispose();
    second.persistence!.dispose();
  }
});

test.each([
  ['save', 'remove'],
  ['remove', 'save'],
  ['choose', 'choose'],
] as const)(
  "a failed %s does not undo another tab's %s during the next save",
  async (failed, saved) => {
    const storage = memoryStorage();
    const writeBatch = vi.spyOn(storage, 'writeBatch');
    const note = dataView<{ id: string; title: string }>('Note')({ id: true, title: true });
    const schema = clientSchema({
      roots: { workspace: { id: 'main', type: 'Workspace' } },
      types: {
        Note: { defaults: (id) => ({ id, title: 'Default' }), view: note },
        Workspace: {
          defaults: (id) => ({ count: 0, id, notes: [{ id: 'seed', title: 'Default' }] }),
          view: dataView<{
            count: number;
            id: string;
            notes: Array<{ id: string; title: string }>;
          }>('Workspace')({ count: true, id: true, notes: list(note) }),
        },
      },
    });
    const make = (title: string) =>
      createClient({
        persistence: createPersistence({ key: 'notes', storage }),
      }).registerClientSchema(schema, ({ mutation }) => ({
        choose: mutation('Workspace', {
          resolve: ({ store }) =>
            store.update('Workspace', 'main', { notes: [{ id: title, title }] }),
        }),
        increment: mutation('Workspace', {
          resolve: ({ store }) =>
            store.update('Workspace', 'main', {
              count: store.get('Workspace', 'main')!.count! + 1,
            }),
        }),
        remove: mutation('Note', {
          resolve: ({ store }) => store.delete('Note', 'seed'),
        }),
        save: mutation('Note', {
          resolve: ({ store }) => store.update('Note', 'seed', { title }),
        }),
      }));
    const first = make('A');
    const second = make('B');
    try {
      await Promise.all([first.persistence!.ready, second.persistence!.ready]);
      writeBatch.mockRejectedValueOnce(new Error('Disk write failed'));
      await expect(first.mutations[failed]()).rejects.toThrow('Disk write failed');
      await second.mutations[saved]();
      await first.mutations.increment();

      const reopened = make('Reopened');
      try {
        await reopened.persistence!.ready;
        const WorkspaceView = view<EntityOf<typeof reopened, 'Workspace'>>()({
          count: true,
          notes: { id: true, title: true },
        });
        const { workspace } = await reopened.request({ workspace: { view: WorkspaceView } });
        expect((await reopened.readView(WorkspaceView, workspace)).data).toMatchObject({
          count: 1,
          notes:
            saved === 'choose'
              ? [{ id: 'B', title: 'B' }]
              : saved === 'save'
                ? [{ id: 'seed', title: 'B' }]
                : [],
        });
        expect(reopened.store.read('Note:seed')?.title).toBe(
          { choose: 'Default', remove: undefined, save: 'B' }[saved],
        );
      } finally {
        reopened.persistence!.dispose();
      }
    } finally {
      first.persistence!.dispose();
      second.persistence!.dispose();
    }
  },
);

test('linking an evicted server record preserves its saved client fields', async () => {
  const post = dataView<{ id: string }>('Post')({ id: true });
  const schema = clientSchema({
    roots: { selection: { id: 'main', type: 'Selection' } },
    typeExtensions: {
      Post: {
        defaults: () => ({ bookmarked: false }),
        view: dataView<{ bookmarked: boolean }>('Post')({ bookmarked: true }),
      },
    },
    types: {
      Selection: {
        defaults: (id) => ({ id, post: null }),
        view: dataView<{ id: string; post: { id: string } | null }>('Selection')({
          id: true,
          post,
        }),
      },
    },
  });
  const storage = memoryStorage();
  const make = () =>
    createClient({
      gcReleaseBufferSize: 0,
      persistence: createPersistence({ key: 'bookmarks', storage }),
      types: [{ type: 'Post' }],
    }).registerClientSchema(schema, ({ mutation }) => ({
      bookmark: mutation('Post', {
        resolve: ({ store }) => store.update('Post', 'p', { bookmarked: true }),
      }),
      choose: mutation('Selection', {
        resolve: ({ store }) => {
          store.update('Selection', 'main', { post: { id: 'p' } });
          return store.get('Post', 'p')?.bookmarked;
        },
      }),
    }));
  const client = make();
  try {
    await client.persistence!.ready;
    client.write('Post', { id: 'p' }, new Set(['id']));
    await client.mutations.bookmark();
    client.gc();
    expect(client.store.read('Post:p')).toBeUndefined();

    const { result: staged } = await client.mutations.choose();
    const memory = client.store.read('Post:p')?.bookmarked;
    const reopened = make();
    try {
      await reopened.persistence!.ready;
      expect({ memory, saved: reopened.store.read('Post:p')?.bookmarked, staged }).toEqual({
        memory: true,
        saved: true,
        staged: true,
      });
    } finally {
      reopened.persistence!.dispose();
    }
  } finally {
    client.persistence!.dispose();
  }
});

test('server data read through a persisted client root is available offline after reload', async () => {
  type Person = { __typename: 'Person'; id: string; name: string };
  const person = dataView<Person>('Person')({ id: true, name: true });
  const selection = dataView<{ id: string; people: Array<Person> }>('Selection')({
    id: true,
    people: list(person),
  });
  const storage = memoryStorage();
  const fetchById = vi.fn(async () => [{ id: 'ada', name: 'Ada' }]);
  const make = () =>
    createClient({
      persistence: createPersistence({ key: 'offline-selection', maxAge: 60_000, storage }),
      transport: { fetchById },
      types: [{ type: 'Person' }],
    }).registerClientSchema(
      clientSchema({
        roots: { selection: { id: 'main', type: 'Selection' } },
        types: { Selection: { defaults: (id) => ({ id, people: [] }), view: selection } },
      }),
      ({ mutation }) => ({
        choose: mutation('Selection', {
          resolve: ({ store }) => store.update('Selection', 'main', { people: [{ id: 'ada' }] }),
        }),
      }),
    );
  const Selection = view<EntityOf<ReturnType<typeof make>, 'Selection'>>()({
    people: { name: true },
  });
  const request = { selection: { view: Selection } };
  const first = make();
  try {
    await first.mutations.choose();
    await first.request(request);
    await first.persistence!.flush();
    expect(fetchById).toHaveBeenCalledOnce();
  } finally {
    first.persistence!.dispose();
  }

  fetchById.mockRejectedValue(new Error('Offline'));
  const reopened = make();
  try {
    const { selection: ref } = await reopened.request(request);
    expect((await reopened.readView(Selection, ref)).data.people).toMatchObject([{ name: 'Ada' }]);
    expect(fetchById).toHaveBeenCalledOnce();
  } finally {
    reopened.persistence!.dispose();
  }
});

test.each(['numeric', 'custom-id', 'id-refetch', 'username-refetch'] as const)(
  'persisted client relationships restore server identities (%s)',
  async (mode) => {
    type Person = { __typename: 'Person'; id: string | number; name: string; username: string };
    const person = dataView<Person>('Person')({ id: true, name: true, username: true });
    const selection = dataView<{ id: string; people: Array<Person>; person: Person | null }>(
      'Selection',
    )({ id: true, people: list(person), person });
    const schema = clientSchema({
      roots: { selection: { id: 'main', type: 'Selection' } },
      types: {
        Selection: { defaults: (id) => ({ id, people: [], person: null }), view: selection },
      },
    });
    const storage = memoryStorage();
    const rawId = mode === 'custom-id' ? 'ada' : 42;
    const fetchById = vi.fn(async (_type: string, ids: Array<string | number>) => {
      expect(ids).toEqual([rawId]);
      return [{ id: 42, name: 'Fresh name', username: 'ada' }];
    });
    const fetchQuery = vi.fn(async (_root, _selection, args) => {
      expect(args).toEqual(mode === 'id-refetch' ? { id: 42 } : { username: 'ada' });
      return { id: 42, name: 'Fresh name', username: 'ada' };
    });
    const make = () =>
      createClient({
        gcReleaseBufferSize: 0,
        persistence: createPersistence({ key: 'relationships', maxAge: 0, storage }),
        transport: { fetchById, fetchQuery },
        types: [
          {
            ...(mode === 'custom-id'
              ? { getId: (record: unknown) => (record as Person).username }
              : {}),
            ...(mode === 'numeric' || mode === 'custom-id'
              ? {}
              : {
                  refetch: {
                    args:
                      mode === 'id-refetch'
                        ? { id: { field: 'id' } }
                        : { username: { field: 'username' } },
                    root: 'person',
                  },
                }),
            type: 'Person',
          },
        ],
      }).registerClientSchema(schema, ({ mutation }) => ({
        choose: mutation('Selection', {
          resolve: ({ store }) =>
            store.update('Selection', 'main', { people: [{ id: rawId }], person: { id: rawId } }),
        }),
      }));
    const Selection = view<EntityOf<ReturnType<typeof make>, 'Selection'>>()({
      people: { name: true },
      person: { name: true },
    });
    const first = make();
    try {
      await first.persistence!.ready;
      first.write(
        'Person',
        { id: 42, name: 'Expired name', username: 'ada' },
        new Set(['id', 'name', 'username']),
      );
      await first.mutations.choose();
      await first.persistence!.clearCache();
    } finally {
      first.persistence!.dispose();
    }

    const reopened = make();
    try {
      await reopened.persistence!.ready;
      expect(reopened.store.read(`Person:${rawId}`)?.name).toBeUndefined();
      reopened.gc();
      const { selection: ref } = await reopened.request({ selection: { view: Selection } });
      expect((await reopened.readView(Selection, ref)).data).toMatchObject({
        people: [{ name: 'Fresh name' }],
        person: { name: 'Fresh name' },
      });
      expect(
        mode === 'numeric' || mode === 'custom-id' ? fetchById : fetchQuery,
      ).toHaveBeenCalledOnce();
    } finally {
      reopened.persistence!.dispose();
    }
  },
);

test.each(['string', 'numeric', 'custom-id', 'username-refetch'] as const)(
  'mutations preserve uncached server relationships after reload (%s)',
  async (mode) => {
    type Person = { id: string | number; name: string; username: string };
    const person = dataView<Person>('Person')({ id: true, name: true, username: true });
    const schema = clientSchema({
      roots: { selection: { id: 'main', type: 'Selection' } },
      types: {
        Selection: {
          defaults: (id) => ({ id, people: [], person: null }),
          view: dataView<{ id: string; people: Array<Person>; person: Person | null }>('Selection')(
            { id: true, people: list(person), person },
          ),
        },
      },
    });
    const storage = memoryStorage();
    const storedId = mode === 'string' ? 'p' : 42;
    const entityId = mode === 'custom-id' ? 'ada' : storedId;
    const fetchById = vi.fn(async (_type: string, ids: Array<string | number>) => {
      expect(ids).toEqual([entityId]);
      return [{ id: storedId, name: 'Fresh', username: 'ada' }];
    });
    const fetchQuery = vi.fn(async () => ({ id: storedId, name: 'Fresh', username: 'ada' }));
    const make = () =>
      createClient({
        persistence: createPersistence({ key: 'relationships', storage }),
        transport: { fetchById, fetchQuery },
        types: [
          {
            ...(mode === 'custom-id'
              ? { getId: (record: unknown) => (record as Person).username }
              : {}),
            ...(mode === 'username-refetch'
              ? { refetch: { args: { username: { field: 'username' } }, root: 'person' } }
              : {}),
            type: 'Person',
          },
        ],
      }).registerClientSchema(schema, ({ mutation }) => ({
        append: mutation('Selection', {
          resolve: ({ store }) => {
            const previous = store.get('Selection', 'main')!;
            store.update('Selection', 'main', {
              people: [...previous.people!, { id: 'new' }],
              person: previous.person,
            });
            return previous;
          },
        }),
        choose: mutation('Selection', {
          resolve: ({ store }) =>
            store.update('Selection', 'main', {
              people: [{ id: entityId }],
              person: { id: entityId },
            }),
        }),
      }));
    const first = make();
    try {
      await first.persistence!.ready;
      first.write(
        'Person',
        { id: storedId, name: 'Expired', username: 'ada' },
        new Set(['id', 'name', 'username']),
      );
      await first.mutations.choose();
      await first.persistence!.clearCache();
    } finally {
      first.persistence!.dispose();
    }

    const reopened = make();
    try {
      await reopened.persistence!.ready;
      expect(reopened.store.read(`Person:${entityId}`)).toBeUndefined();
      const { result } = await reopened.mutations.append();
      expect(result).toMatchObject({
        people: [{ __typename: 'Person', id: storedId }],
        person: { __typename: 'Person', id: storedId },
      });
      expect(result?.person).not.toHaveProperty('name');
      expect(reopened.store.read(`Person:${entityId}`)?.id).toBe(storedId);
      expect(fetchById).not.toHaveBeenCalled();
      expect(fetchQuery).not.toHaveBeenCalled();
      const Selection = view<EntityOf<typeof reopened, 'Selection'>>()({
        person: { name: true },
      });
      const { selection } = await reopened.request({ selection: { view: Selection } });
      expect((await reopened.readView(Selection, selection)).data.person?.name).toBe('Fresh');
      await reopened.persistence!.clearCache();
    } finally {
      reopened.persistence!.dispose();
    }

    const restored = make();
    try {
      await restored.persistence!.ready;
      const Selection = view<EntityOf<typeof restored, 'Selection'>>()({
        person: { name: true },
      });
      const { selection } = await restored.request({ selection: { view: Selection } });
      expect((await restored.readView(Selection, selection)).data.person?.name).toBe('Fresh');
      if (mode === 'username-refetch') {
        expect(fetchQuery).toHaveBeenCalledWith(
          'person',
          expect.anything(),
          { username: 'ada' },
          { refetch: 'Person' },
        );
      } else {
        expect(fetchById).toHaveBeenCalledWith('Person', [entityId], expect.anything(), undefined);
      }
    } finally {
      restored.persistence!.dispose();
    }
  },
);

test('in-memory relationship edits do not discard saved server identities', async () => {
  type Person = { __typename: 'Person'; id: number; name: string };
  const person = dataView<Person>('Person')({ id: true, name: true });
  const selection = dataView<{ count: number; id: string; person: Person | null }>('Selection')({
    count: true,
    id: true,
    person,
  });
  const storage = memoryStorage();
  const fetchById = vi.fn(async (_type: string, ids: Array<string | number>) => {
    expect(ids).toEqual([42]);
    return [{ id: 42, name: 'Saved person' }];
  });
  const make = () =>
    createClient({
      gcReleaseBufferSize: 0,
      persistence: createPersistence({ key: 'relationships', maxAge: 0, storage }),
      transport: { fetchById },
      types: [{ type: 'Person' }],
    }).registerClientSchema(
      clientSchema({
        roots: { selection: { id: 'main', type: 'Selection' } },
        types: {
          Selection: {
            defaults: (id) => ({ count: 0, id, person: null }),
            view: selection,
          },
        },
      }),
      ({ mutation }) => ({
        choose: mutation('Selection', {
          resolve: ({ store }) => store.update('Selection', 'main', { person: { id: 42 } }),
        }),
        chooseOther: mutation('Selection', {
          resolve: ({ store }) => store.update('Selection', 'main', { person: { id: 43 } }),
        }),
        increment: mutation('Selection', {
          resolve: ({ store }) => store.update('Selection', 'main', { count: 1 }),
        }),
      }),
    );
  const first = make();
  try {
    await first.mutations.choose();
    await first.mutations.chooseOther({ persist: false });
    first.gc();
    expect(first.store.read('Person:42')).toBeUndefined();
    await first.mutations.increment();
    await first.persistence!.clearCache();
  } finally {
    first.persistence!.dispose();
  }

  const reopened = make();
  try {
    const Selection = view<EntityOf<typeof reopened, 'Selection'>>()({
      count: true,
      person: { name: true },
    });
    const { selection: ref } = await reopened.request({ selection: { view: Selection } });
    expect((await reopened.readView(Selection, ref)).data).toMatchObject({
      count: 1,
      person: { name: 'Saved person' },
    });
  } finally {
    reopened.persistence!.dispose();
  }
});
