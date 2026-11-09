import { expect, test, vi } from 'vite-plus/test';
import { z } from 'zod';
import { clientSchema, type EntityOf } from '../client-schema.ts';
import { createClient } from '../client.ts';
import { dataView, list } from '../data-view.ts';
import { encodeHydrationValue } from '../hydration.ts';
import {
  createPersistence,
  type ClientStateMigration,
  type ClientStatePersistenceOptions,
} from '../persistence.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

const note = dataView<{ id: string; text: string }>('Note')({ id: true, text: true });
const v1 = clientSchema({
  roots: { workspace: { id: 'main', type: 'Workspace' } },
  types: {
    Note: { defaults: (id) => ({ id, text: '' }), view: note },
    Workspace: {
      defaults: (id) => ({ id, notes: [{ id: 'seed', text: 'Seed' }], title: 'Untitled' }),
      view: dataView<{ id: string; notes: Array<{ id: string; text: string }>; title: string }>(
        'Workspace',
      )({ id: true, notes: list(note), title: true }),
    },
  },
});
const v2 = clientSchema({
  roots: { workspace: { id: 'main', type: 'Workspace' } },
  types: {
    Note: v1.types.Note,
    Workspace: {
      defaults: (id) => ({
        archived: false,
        drafts: [{ id: 'seed', text: 'Seed' }],
        id,
        name: 'Untitled',
      }),
      view: dataView<{
        archived: boolean;
        drafts: Array<{ id: string; text: string }>;
        id: string;
        name: string;
      }>('Workspace')({ archived: true, drafts: list(note), id: true, name: true }),
    },
  },
});
const store = (
  storage: ReturnType<typeof memoryStorage>,
  clientState?: ClientStatePersistenceOptions,
  key = 'workspace',
) => createClient({ persistence: createPersistence({ clientState, key, storage }) });

const openV1 = (storage: ReturnType<typeof memoryStorage>) =>
  store(storage).registerClientSchema(v1, ({ mutation }) => ({
    save: mutation('Workspace', {
      resolve: ({ store }) => {
        store.delete('Note', 'seed');
        return store.update('Workspace', 'main', {
          notes: [{ id: 'saved', text: 'Draft' }],
          title: 'Saved',
        });
      },
    }),
  }));
const openV2 = (
  storage: ReturnType<typeof memoryStorage>,
  clientState?: ClientStatePersistenceOptions,
  key?: string,
) => store(storage, clientState, key).registerClientSchema(v2);
const Workspace = view<EntityOf<ReturnType<typeof openV2>, 'Workspace'>>()({
  archived: true,
  drafts: { id: true, text: true },
  name: true,
});
const read = async (client: ReturnType<typeof openV2>) => {
  const { workspace } = await client.request({ workspace: { view: Workspace } });
  return (await client.readView(Workspace, workspace)).data;
};

test('migrates records and lists once across racing sessions and rejects older writers', async () => {
  const storage = memoryStorage();
  const first = openV1(storage);
  await first.mutations.save();
  const rename = vi.fn<ClientStateMigration>((state) => {
    state.renameField('Workspace', 'title', 'name');
    state.renameField('Workspace', 'notes', 'drafts');
  });
  const migrate = {
    migrations: {
      2: rename,
      3: (state) =>
        state.mapRecords('Workspace', (record) => ({ ...record, name: `${record.name} v3` })),
    },
    version: 3,
  } satisfies ClientStatePersistenceOptions;
  const second = openV2(storage, migrate);
  const third = openV2(storage, migrate);
  const isolated = openV2(storage, migrate, 'other');
  try {
    const expected = {
      archived: false,
      drafts: [{ id: 'saved', text: 'Draft' }],
      name: 'Saved v3',
    };
    expect(await Promise.all([read(second), read(third)])).toMatchObject([expected, expected]);
    expect(rename).toHaveBeenCalledOnce();
    expect(second.store.read('Note:seed')).toBeUndefined();
    expect(second.store.read('Workspace:main')).not.toHaveProperty('notes');
    await expect(first.mutations.save()).rejects.toThrow('requires a newer app');
    expect(await read(isolated)).toMatchObject({ name: 'Untitled' });
  } finally {
    for (const client of [first, second, third, isolated]) {
      client.persistence!.dispose();
    }
  }
});

test('client records survive additive schema changes without a version bump', async () => {
  const storage = memoryStorage();
  const first = openV1(storage);
  await first.mutations.save();
  first.persistence!.dispose();
  const client = store(storage).registerClientSchema(
    clientSchema({
      ...v1,
      types: {
        ...v1.types,
        Workspace: {
          defaults: (id) => ({ archived: false, id, notes: [], title: 'Untitled' }),
          view: dataView<{
            archived: boolean;
            id: string;
            notes: Array<{ id: string; text: string }>;
            title: string;
          }>('Workspace')({ archived: true, id: true, notes: list(note), title: true }),
        },
      },
    }),
  );
  try {
    await client.persistence!.ready;
    expect(client.store.read('Workspace:main')).toMatchObject({ archived: false, title: 'Saved' });
    expect(client.store.read('Note:saved')?.text).toBe('Draft');
  } finally {
    client.persistence!.dispose();
  }
});

test('client state budgets and serialization limits are independent of the read cache', async () => {
  const storage = memoryStorage();
  const payload = 'x'.repeat(1_000_001);
  const make = (clientState?: ClientStatePersistenceOptions) =>
    createClient({
      persistence: createPersistence({ clientState, key: 'limits', maxBytes: 1024, storage }),
    }).registerClientSchema(v1, ({ mutation }) => ({
      save: mutation('Workspace', {
        resolve: ({ store }) => store.update('Workspace', 'main', { title: payload }),
      }),
    }));
  const options = { limits: { maxStringLength: payload.length }, maxBytes: 2 * 1024 * 1024 };
  const defaultLimit = make({ maxBytes: options.maxBytes });
  const smallBudget = make({ ...options, maxBytes: 1024 });
  const client = make(options);
  try {
    await expect(defaultLimit.mutations.save()).rejects.toThrow('Maximum string length');
    await expect(smallBudget.mutations.save()).rejects.toThrow('storage size limit');
    expect(smallBudget.store.read('Workspace:main')?.title).toBe('Untitled');
    await client.mutations.save();
    await client.persistence!.clearCache();
    const reopened = make(options);
    try {
      await reopened.persistence!.ready;
      expect(reopened.store.read('Workspace:main')?.title).toBe(payload);
    } finally {
      reopened.persistence!.dispose();
    }
  } finally {
    for (const session of [defaultLimit, smallBudget, client]) {
      session.persistence!.dispose();
    }
  }
});

test('restored entry sizes count toward the budget and replacements reclaim space', async () => {
  const storage = memoryStorage();
  const schema = clientSchema({
    types: {
      Note: { defaults: (id) => ({ id, text: '' }), view: note },
    },
  });
  const input = z.object({ id: z.string() });
  const make = () =>
    store(storage, { maxBytes: 1700 }).registerClientSchema(schema, ({ mutation }) => ({
      remove: mutation('Note', {
        input,
        resolve: ({ input, store }) => store.delete('Note', input.id),
      }),
      save: mutation('Note', {
        input: input.extend({ text: z.string() }),
        resolve: ({ input, store }) =>
          store.get('Note', input.id)
            ? store.update('Note', input.id, { text: input.text })
            : store.create('Note', input),
      }),
    }));
  const first = make();
  await first.mutations.save({ input: { id: 'a', text: 'x'.repeat(1000) } });
  first.persistence!.dispose();
  const reopened = make();
  try {
    const next = { id: 'b', text: 'z'.repeat(1000) };
    await expect(reopened.mutations.save({ input: next })).rejects.toThrow('storage size limit');
    expect(reopened.store.read('Note:b')).toBeUndefined();
    await reopened.mutations.save({ input: { id: 'a', text: 'y'.repeat(1000) } });
    await reopened.mutations.remove({ input: { id: 'a' } });
    await reopened.mutations.save({ input: next });
    expect(reopened.store.read('Note:b')?.text).toBe(next.text);
  } finally {
    reopened.persistence!.dispose();
  }
});

test.each(['missing migration', 'throw', 'write failure'] as const)(
  'keeps the old graph readable after an upgrade fails with %s',
  async (failure) => {
    const storage = memoryStorage();
    const first = openV1(storage);
    await first.mutations.save();
    first.persistence!.dispose();
    const writeBatch = storage.writeBatch;
    storage.writeBatch = async (writes) => {
      if (failure === 'write failure' && writes.some(([key]) => key.includes('client-state-v2'))) {
        throw new Error('Disk write failed');
      }
      await writeBatch(writes);
    };
    const upgraded = openV2(storage, {
      migrations:
        failure === 'missing migration'
          ? {}
          : {
              2(state) {
                state.renameField('Workspace', 'title', 'name');
                if (failure === 'throw') {
                  throw new Error('Migration failed');
                }
              },
            },
      version: 2,
    });
    await expect(upgraded.persistence!.ready).rejects.toThrow(
      {
        'missing migration': 'Missing client state migration to version 2',
        throw: 'Migration failed',
        'write failure': 'Disk write failed',
      }[failure],
    );
    upgraded.persistence!.dispose();
    const original = openV1(storage);
    try {
      await original.persistence!.ready;
      expect(original.store.read('Workspace:main')).toMatchObject({ title: 'Saved' });
      expect(original.store.read('Note:saved')?.text).toBe('Draft');
    } finally {
      original.persistence!.dispose();
    }
  },
);

test('imports a scope-keyed graph before upgrading and leaves the original copy intact', async () => {
  const storage = memoryStorage();
  const legacyScope = 'old-scope';
  const key = JSON.stringify(['workspace', 'client-state-v1', legacyScope]);
  const legacy = encodeHydrationValue({
    lists: [],
    records: [['Workspace:main', { id: 'main', title: 'Legacy' }]],
  });
  await storage.writeBatch([[key, legacy]]);
  const options = {
    legacyScope,
    migrations: { 2: (state) => state.renameField('Workspace', 'title', 'name') },
    version: 2,
  } satisfies ClientStatePersistenceOptions;
  const first = openV2(storage, options);
  try {
    expect(await read(first)).toMatchObject({ archived: false, name: 'Legacy' });
  } finally {
    first.persistence!.dispose();
  }
  expect(await storage.read(key)).toEqual(legacy);
  const reopened = openV2(storage, { version: 2 });
  try {
    expect(await read(reopened)).toMatchObject({ archived: false, name: 'Legacy' });
  } finally {
    reopened.persistence!.dispose();
  }
});
