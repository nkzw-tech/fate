import { afterEach, expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { mutation } from '../mutation.ts';
import type { MutationIdentity, PersistenceSession } from '../persistence-types.ts';
import { createPersistence, type PersistenceStorage } from '../persistence.ts';
import { FateRequestError } from '../protocol.ts';
import { toEntityId } from '../ref.ts';
import { clientRoot } from '../root.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

type Note = { __typename: 'Note'; id: string; title: string };
const NoteView = view<Note>()({ id: true, title: true });
const noteId = toEntityId('Note', '1');
const sessions: Array<PersistenceSession> = [];
afterEach(() => {
  for (const session of sessions.splice(0)) {
    session.dispose();
  }
});
const setup = (
  options: {
    durable?: boolean;
    key?: string;
    maxBytes?: number;
    mutate?: (
      input: { id: string; title: string },
      identity?: MutationIdentity,
    ) => Promise<unknown>;
    online?: () => boolean;
    storage?: PersistenceStorage;
  } = {},
) => {
  const storage = options.storage ?? memoryStorage();
  const mutate = vi.fn(
    async (_name: string, input: any, _select: Set<string>, identity?: MutationIdentity) =>
      options.mutate ? options.mutate(input, identity) : { ...input, __typename: 'Note' },
  );
  const fetchById = vi.fn(async () => [{ __typename: 'Note', id: '1', title: 'Server' }]);
  const mutations = { edit: mutation<Note, { id: string; title: string }, Note>('Note') };
  const roots = { note: clientRoot('Note') };
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    persistence: createPersistence({
      key: options.key ?? 'account:1',
      maxBytes: options.maxBytes,
      online: options.online ?? (() => false),
      retryDelay: 20,
      storage,
    }),
    roots,
    transport: { fetchById, mutate, mutateDurably: options.durable === false ? undefined : mutate },
    types: [{ fields: { title: 'scalar' }, type: 'Note' }],
  });
  sessions.push(client.persistence!);
  return { client, fetchById, mutate, session: client.persistence!, storage };
};
const queued = async (session: PersistenceSession, count = 1) => {
  await vi.waitFor(() => expect(session.getSnapshot().mutations).toHaveLength(count));
};

test.each([false, true])(
  'missing optimistic fields wait for durable confirmation (restored=%s)',
  async (restored) => {
    let online = false;
    const options = {
      mutate: async () => ({ __typename: 'Note', id: '1' }),
      online: () => online,
    };
    const first = setup(options);
    const submission = first.client.mutations
      .edit({
        input: { id: 'temporary', title: 'Draft' },
        optimistic: { id: 'temporary' },
        view: NoteView,
      })
      .catch(() => {});
    await queued(first.session);
    if (restored) {
      first.session.dispose();
      await submission;
    }
    const current = restored ? setup({ ...options, storage: first.storage }) : first;
    await current.session.ready;
    const read = Promise.resolve(
      current.client.readView(NoteView, current.client.ref('Note', 'temporary', NoteView)),
    );
    // Allow a mistakenly started fetch to run through the restoration barrier.
    await Promise.resolve();
    expect(current.fetchById).not.toHaveBeenCalled();
    online = true;
    current.session.retry();
    await expect(read).resolves.toMatchObject({ data: { id: '1', title: 'Server' } });
    await submission;
    expect(current.fetchById).toHaveBeenCalledTimes(1);
    expect(current.fetchById.mock.calls[0]).toEqual(['Note', ['1'], new Set(['title']), undefined]);
  },
);

test.each(['reject', 'discard', 'dispose'] as const)(
  'durable %s releases reads waiting on optimistic fields',
  async (outcome) => {
    let online = false;
    const { client, fetchById, session } = setup({
      mutate: async () => {
        throw new FateRequestError('BAD_REQUEST', 'Rejected');
      },
      online: () => online,
    });
    const submission = client.mutations
      .edit({
        input: { id: '1', title: 'Draft' },
        optimistic: { id: '1' },
      })
      .catch(() => {});
    await queued(session);
    const read = Promise.resolve(client.readView(NoteView, client.ref('Note', '1', NoteView)));
    const settled = read.then(
      () => 'fulfilled',
      () => 'rejected',
    );
    await Promise.resolve();
    expect(fetchById).not.toHaveBeenCalled();
    if (outcome === 'reject') {
      online = true;
      session.retry();
    } else if (outcome === 'discard') {
      await session.discard(session.getSnapshot().mutations[0].id);
    } else {
      session.dispose();
    }
    await expect(settled).resolves.toBe(outcome === 'dispose' ? 'rejected' : 'fulfilled');
    await submission;
    expect(client.store.hasOptimisticUpdates).toBe(false);
    expect(fetchById).toHaveBeenCalledTimes(outcome === 'dispose' ? 0 : 1);
  },
);

test('restores cached coverage before requests and direct view reads start', async () => {
  const first = setup();
  await first.session.ready;
  await first.client.request({ note: { id: '1', view: NoteView } });
  await first.session.flush();
  first.session.dispose();
  const next = setup({ storage: first.storage });
  const request = next.client.request({ note: { id: '1', view: NoteView } });
  const result = await next.client.readView(NoteView, next.client.ref('Note', '1', NoteView));
  await request;
  expect(result.data).toMatchObject({ title: 'Server' });
  expect(next.fetchById).not.toHaveBeenCalled();
});

test('journals before sending, restores optimistic state, and replays in order after restart', async () => {
  const first = setup();
  await first.session.ready;
  first.client.write('Note', { id: '1', title: 'Original' }, new Set(['id', 'title']));
  const pending = ['A', 'B'].map((title) =>
    first.client.mutations
      .edit({ input: { id: '1', title }, optimistic: { title } })
      .catch(() => {}),
  );
  await queued(first.session, 2);
  await first.session.flush();
  expect(first.client.store.read(noteId)?.title).toBe('B');
  expect(first.mutate).not.toHaveBeenCalled();
  first.session.dispose();
  await Promise.all(pending);
  let online = false;
  const next = setup({ online: () => online, storage: first.storage });
  await next.session.ready;
  expect(next.client.store.read(noteId)?.title).toBe('B');
  online = true;
  next.session.retry();
  await queued(next.session, 0);
  expect(next.mutate.mock.calls.map((call) => call[1].title)).toEqual(['A', 'B']);
  expect(next.client.store.read(noteId)?.title).toBe('B');
});

test('lost responses reuse identity and execute one logical effect', async () => {
  const receipts = new Map<string, unknown>();
  let effects = 0;
  const { client, mutate, session } = setup({
    mutate: async (input, identity) => {
      expect(identity?.scope).toBe('account:1');
      if (receipts.has(identity!.id)) {
        return receipts.get(identity!.id);
      }
      effects++;
      receipts.set(identity!.id, { ...input, __typename: 'Note' });
      throw new TypeError('Response lost after commit');
    },
    online: () => true,
  });
  const response = await client.mutations.edit({ input: { id: '1', title: 'Saved' } });
  expect(response.result?.title).toBe('Saved');
  expect(effects).toBe(1);
  expect(mutate).toHaveBeenCalledTimes(2);
  expect(mutate.mock.calls[0][3]).toEqual(mutate.mock.calls[1][3]);
  expect(session.getSnapshot().mutations).toHaveLength(0);
});

test('multiple clients share one delivery lock and both observe confirmation', async () => {
  const storage = memoryStorage();
  const effect = vi.fn(async (input) => ({ ...input, __typename: 'Note' }));
  const first = setup({ mutate: effect, online: () => true, storage });
  const second = setup({ mutate: effect, online: () => true, storage });
  await Promise.all([first.session.ready, second.session.ready]);
  const results = await Promise.all([
    first.client.mutations.edit({ input: { id: '1', title: 'A' }, optimistic: { title: 'A' } }),
    second.client.mutations.edit({ input: { id: '1', title: 'B' }, optimistic: { title: 'B' } }),
  ]);
  expect(results.map((result) => result.result?.title)).toEqual(['A', 'B']);
  expect(effect).toHaveBeenCalledTimes(2);
  await queued(first.session, 0);
  await queued(second.session, 0);
  expect(first.client.store.read(noteId)?.title).toBe('B');
  expect(second.client.store.read(noteId)?.title).toBe('B');
});

test('terminal rejection rolls back after a restart and preserves its input for inspection', async () => {
  const first = setup();
  await first.session.ready;
  first.client.write('Note', { id: '1', title: 'Original' }, new Set(['id', 'title']));
  const pending = first.client.mutations
    .edit({ input: { id: '1', title: 'Invalid' }, optimistic: { title: 'Invalid' } })
    .catch(() => {});
  await queued(first.session);
  first.session.dispose();
  await pending;
  const next = setup({
    mutate: async () => {
      throw new FateRequestError('BAD_REQUEST', 'Invalid title');
    },
    online: () => true,
    storage: first.storage,
  });
  await vi.waitFor(() => expect(next.session.getSnapshot().mutations[0]?.status).toBe('failed'));
  expect(next.client.store.read(noteId)?.title).toBe('Original');
  await next.session.discard(next.session.getSnapshot().mutations[0].id);
  await queued(next.session, 0);
});

test('persist false uses the existing action API without journaling or identity', async () => {
  const { client, mutate, session } = setup({ durable: false });
  const result = await client.actions.edit(null, {
    input: { id: '1', title: 'Immediate' },
    persist: false,
  });
  expect(result.result?.title).toBe('Immediate');
  expect(mutate.mock.calls[0][3]).toBeUndefined();
  expect(session.getSnapshot().mutations).toHaveLength(0);
});

test('storage failure prevents execution and optimistic writes', async () => {
  const storage = memoryStorage();
  storage.writeBatch = async () => {
    throw new Error('Quota exceeded');
  };
  const { client, mutate } = setup({ online: () => true, storage });
  await expect(
    client.mutations.edit({ input: { id: '1', title: 'A' }, optimistic: { title: 'A' } }),
  ).rejects.toThrow('Quota exceeded');
  expect(mutate).not.toHaveBeenCalled();
  expect(client.store.read(noteId)).toBeUndefined();
});

test('unsupported transport fails before executing and account keys isolate the journal', async () => {
  const first = setup({ durable: false, online: () => true });
  const response = await first.client.mutations.edit({ input: { id: '1', title: 'A' } });
  expect(response.error?.message).toMatch(/idempotency/i);
  expect(first.mutate).not.toHaveBeenCalled();
  expect(first.session.getSnapshot().mutations).toEqual([]);
  expect(await first.storage.read('account:1')).toBeUndefined();
  const second = setup({ key: 'account:2', online: () => true, storage: first.storage });
  await second.session.ready;
  expect(second.session.getSnapshot().mutations).toHaveLength(0);
  expect(second.client.store.read(noteId)).toBeUndefined();
});

test('corrupt data blocks restore without overwriting the journal', async () => {
  const storage = memoryStorage();
  await storage.write('account:1', { mutations: ['corrupt'], version: 999 });
  const { client, mutate, session } = setup({ online: () => true, storage });
  await expect(session.ready).rejects.toThrow(/corrupt/);
  await expect(client.mutations.edit({ input: { id: '1', title: 'A' } })).rejects.toThrow(
    /corrupt/,
  );
  expect(mutate).not.toHaveBeenCalled();
  expect(await storage.read('account:1')).toEqual({ mutations: ['corrupt'], version: 999 });
});

test('captures caller input before async restore and refuses unserializable commands', async () => {
  const { client, mutate, session } = setup({ online: () => true });
  const input = { id: '1', title: 'At invocation' };
  const pending = client.mutations.edit({ input });
  input.title = 'Changed later';
  expect((await pending).result?.title).toBe('At invocation');
  await expect(
    client.mutations.edit({ input: { id: '1', title: (() => {}) as unknown as string } }),
  ).rejects.toThrow();
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(session.getSnapshot().mutations).toHaveLength(0);
});

test('an attempted command cannot be discarded while its remote outcome is unknown', async () => {
  const response = Promise.withResolvers<unknown>();
  const { client, session } = setup({ mutate: () => response.promise, online: () => true });
  const pending = client.mutations.edit({ input: { id: '1', title: 'A' } });
  await vi.waitFor(() => expect(session.getSnapshot().mutations[0]?.status).toBe('sending'));
  const id = session.getSnapshot().mutations[0].id;
  await expect(session.discard(id)).rejects.toThrow(/may have committed remotely/);
  response.resolve({ id: '1', title: 'A' });
  expect((await pending).result?.title).toBe('A');
});

test('acknowledgement write failure keeps the same identity until receipt storage recovers', async () => {
  const storage = memoryStorage();
  const writeBatch = storage.writeBatch;
  let failed = false;
  storage.writeBatch = async (entries) => {
    if (
      !failed &&
      entries.some(
        ([, value]) =>
          (value as { entry?: { status: string } } | undefined)?.entry?.status === 'confirmed',
      )
    ) {
      failed = true;
      throw new Error('Disk temporarily unavailable');
    }
    await writeBatch(entries);
  };
  const { client, mutate } = setup({ online: () => true, storage });
  expect((await client.mutations.edit({ input: { id: '1', title: 'Saved' } })).result?.title).toBe(
    'Saved',
  );
  expect(failed).toBe(true);
  expect(mutate.mock.calls[0][3]).toEqual(mutate.mock.calls[1][3]);
});

test('GC can collect unrelated data while retaining durable optimistic records', async () => {
  const { client, session } = setup();
  await session.ready;
  client.write('Note', { id: '1', title: 'Original' }, new Set(['id', 'title']));
  client.write('Note', { id: 'unused', title: 'Unrelated' }, new Set(['id', 'title']));
  const pending = client.mutations
    .edit({ input: { id: '1', title: 'Pending' }, optimistic: { title: 'Pending' } })
    .catch(() => {});
  await queued(session);
  client.gc();
  expect(client.store.read(noteId)?.title).toBe('Pending');
  expect(client.store.read(toEntityId('Note', 'unused'))).toBeUndefined();
  await session.discard(session.getSnapshot().mutations[0].id);
  await pending;
  expect(client.store.read(noteId)?.title).toBe('Original');
});

test('live writes beneath optimistic updates survive reload and terminal rollback', async () => {
  const first = setup();
  await first.session.ready;
  first.client.write('Note', { id: '1', title: 'Original' }, new Set(['id', 'title']));
  const pending = first.client.mutations
    .edit({ input: { id: '1', title: 'Pending' }, optimistic: { title: 'Pending' } })
    .catch(() => {});
  await queued(first.session);
  first.client.write('Note', { id: '1', title: 'Live' }, new Set(['id', 'title']));
  await first.session.flush();
  first.session.dispose();
  await pending;
  const next = setup({ storage: first.storage });
  await next.session.ready;
  expect(next.client.store.read(noteId)?.title).toBe('Pending');
  await next.session.discard(next.session.getSnapshot().mutations[0].id);
  expect(next.client.store.read(noteId)?.title).toBe('Live');
});

test('GC preserves references in the rollback base when optimism replaces a relationship', async () => {
  type Item = {
    __typename: 'Item';
    child: { __typename: 'Child'; id: string; name: string };
    id: string;
  };
  const mutations = { edit: mutation<Item, { id: string }, Item>('Item') };
  const client = createClient<[Record<never, never>, typeof mutations]>({
    mutations,
    persistence: createPersistence({
      key: 'related',
      online: () => false,
      storage: memoryStorage(),
    }),
    roots: {},
    transport: {
      fetchById: async () => [],
      mutateDurably: async () => {
        throw new Error('Unexpected delivery while offline');
      },
    },
    types: [{ fields: { child: { type: 'Child' } }, type: 'Item' }, { type: 'Child' }],
  });
  const session = client.persistence!;
  sessions.push(session);
  await session.ready;
  client.write(
    'Item',
    { child: { id: 'old', name: 'Original child' }, id: '1' },
    new Set(['id', 'child.id', 'child.name']),
  );
  const pending = client.mutations
    .edit({
      input: { id: '1' },
      optimistic: { child: { __typename: 'Child', id: 'new', name: 'New child' } },
    })
    .catch(() => {});
  await queued(session);
  client.gc();
  expect(client.store.read(toEntityId('Child', 'old'))?.name).toBe('Original child');
  await session.discard(session.getSnapshot().mutations[0].id);
  await pending;
  expect(client.store.read(toEntityId('Child', 'old'))?.name).toBe('Original child');
});

test('discard racing with the delivery claim cannot send a removed command', async () => {
  const storage = memoryStorage();
  const exclusive = storage.exclusive;
  const claiming = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const delivered = Promise.withResolvers<void>();
  let intercept = false;
  storage.exclusive = (key, run) => {
    if (key.endsWith(':delivery')) {
      return exclusive(key, async () => {
        intercept = true;
        try {
          return await run();
        } finally {
          delivered.resolve();
        }
      });
    }
    if (intercept && key.endsWith(':write')) {
      intercept = false;
      claiming.resolve();
      return resume.promise.then(() => exclusive(key, run));
    }
    return exclusive(key, run);
  };
  let online = false;
  const { client, mutate, session } = setup({ online: () => online, storage });
  const pending = client.mutations.edit({ input: { id: '1', title: 'Cancelled' } }).catch(() => {});
  await queued(session);
  online = true;
  session.retry();
  await claiming.promise;
  await session.discard(session.getSnapshot().mutations[0].id);
  resume.resolve();
  await delivered.promise;
  await pending;
  expect(mutate).not.toHaveBeenCalled();
});

test('missing durable adapter preserves restored commands and still restores the read cache', async () => {
  const first = setup();
  await first.client.request({ note: { id: '1', view: NoteView } });
  const pending = first.client.mutations
    .edit({
      input: { id: '1', title: 'Offline edit' },
      optimistic: { title: 'Offline edit' },
    })
    .catch(() => {});
  await queued(first.session);
  first.session.dispose();
  await pending;
  const stored = await first.storage.read('account:1');
  const next = setup({ durable: false, online: () => true, storage: first.storage });
  await next.session.ready;
  next.session.retry();
  const view = await next.client.readView(NoteView, next.client.ref('Note', '1', NoteView));
  expect(view.data).toMatchObject({ title: 'Offline edit' });
  expect(next.fetchById).not.toHaveBeenCalled();
  expect(next.mutate).not.toHaveBeenCalled();
  expect(next.session.getSnapshot().mutations[0].status).toBe('queued');
  expect(await first.storage.read('account:1')).toEqual(stored);
  next.session.dispose();
  const repaired = setup({ online: () => true, storage: first.storage });
  await vi.waitFor(() => expect(repaired.mutate).toHaveBeenCalledTimes(1));
  await queued(repaired.session, 0);
});

test('the size budget rejects new durable work before optimism or delivery', async () => {
  const { client, mutate, session } = setup({ maxBytes: 1500, online: () => true });
  await expect(
    client.mutations.edit({
      input: { id: '1', title: 'x'.repeat(2000) },
      optimistic: { title: 'Pending' },
    }),
  ).rejects.toThrow('size limit');
  expect(mutate).not.toHaveBeenCalled();
  expect(client.store.read(noteId)).toBeUndefined();
  expect(session.getSnapshot().mutations).toHaveLength(0);
});

test('reducing the size budget preserves already queued mutations', async () => {
  const first = setup();
  const pending = first.client.mutations
    .edit({ input: { id: '1', title: 'x'.repeat(2000) } })
    .catch(() => {});
  await queued(first.session);
  first.session.dispose();
  await pending;
  const before = await first.storage.read('account:1');
  const next = setup({ maxBytes: 1500, storage: first.storage });
  await next.session.ready;
  expect(next.session.getSnapshot().mutations).toHaveLength(1);
  expect(await first.storage.read('account:1')).toEqual(before);
  await expect(next.client.mutations.edit({ input: { id: '2', title: 'More' } })).rejects.toThrow(
    'size limit',
  );
  expect(await first.storage.read('account:1')).toEqual(before);
});

test('mutation recovery does not restore unrelated read-cache records', async () => {
  const first = setup();
  await first.session.ready;
  first.client.write('Note', { id: '1', title: 'Original' }, new Set(['id', 'title']));
  first.client.write('Note', { id: 'unrelated', title: 'Do not pin' }, new Set(['id', 'title']));
  const pending = first.client.mutations
    .edit({ input: { id: '1', title: 'Pending' }, optimistic: { title: 'Pending' } })
    .catch(() => {});
  await queued(first.session);
  first.session.dispose();
  await pending;
  const next = setup({ storage: first.storage });
  await next.session.ready;
  expect(next.client.store.read(noteId)?.title).toBe('Pending');
  expect(next.client.store.read(toEntityId('Note', 'unrelated'))).toBeUndefined();
});

test('an oversized confirmation settles without retrying an already completed command', async () => {
  const { client, mutate, session, storage } = setup({
    maxBytes: 2500,
    mutate: async () => ({ __typename: 'Note', id: '1', title: 'x'.repeat(10_000) }),
    online: () => true,
  });
  expect(
    (await client.mutations.edit({ input: { id: '1', title: 'Small input' } })).result?.title,
  ).toHaveLength(10_000);
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(session.getSnapshot().mutations).toHaveLength(0);
  await session.clearCache();
  expect(
    (await client.mutations.edit({ input: { id: '2', title: 'More' } })).result?.title,
  ).toHaveLength(10_000);
  await session.flush();
  expect(await storage.scan(`${JSON.stringify(['account:1', 'journal'])}:`)).toEqual([]);
});

test('lowering the budget still permits delivery and clearing the read cache', async () => {
  const first = setup();
  const pending = first.client.mutations
    .edit({ input: { id: '1', title: 'x'.repeat(2000) } })
    .catch(() => {});
  await queued(first.session);
  first.session.dispose();
  await pending;
  const next = setup({ maxBytes: 1500, online: () => true, storage: first.storage });
  await next.session.ready;
  await next.session.clearCache();
  await queued(next.session, 0);
  expect(next.mutate).toHaveBeenCalledTimes(1);
});

test('another tab does not replace a newer durable rollback base with stale memory', async () => {
  const first = setup();
  await first.session.ready;
  first.client.write('Note', { id: '1', title: 'Original' }, new Set(['id', 'title']));
  const pending = first.client.mutations
    .edit({ input: { id: '1', title: 'Pending' }, optimistic: { title: 'Pending' } })
    .catch(() => {});
  await queued(first.session);
  await first.session.flush();
  const second = setup({ storage: first.storage });
  await second.session.ready;
  first.client.write('Note', { id: '1', title: 'Live' }, new Set(['id', 'title']));
  await first.session.flush();
  await second.session.flush();
  first.session.dispose();
  second.session.dispose();
  await pending;
  const next = setup({ storage: first.storage });
  await next.session.ready;
  await next.session.discard(next.session.getSnapshot().mutations[0].id);
  expect(next.client.store.read(noteId)?.title).toBe('Live');
});

test('confirmed writes hidden beneath optimism automatically refresh durable recovery data', async () => {
  const first = setup();
  await first.session.ready;
  first.client.write('Note', { id: '1', title: 'Original' }, new Set(['id', 'title']));
  const pending = first.client.mutations
    .edit({ input: { id: '1', title: 'Pending' }, optimistic: { title: 'Pending' } })
    .catch(() => {});
  await queued(first.session);
  await first.session.flush();
  first.client.write('Note', { id: '1', title: 'Live underneath' }, new Set(['id', 'title']));
  expect(first.client.store.read(noteId)?.title).toBe('Pending');
  await vi.waitFor(async () =>
    expect(
      JSON.stringify(await first.storage.scan(`${JSON.stringify(['account:1', 'journal'])}:`)),
    ).toContain('Live underneath'),
  );
  first.session.dispose();
  await pending;
  const next = setup({ storage: first.storage });
  await next.session.ready;
  await next.session.discard(next.session.getSnapshot().mutations[0].id);
  expect(next.client.store.read(noteId)?.title).toBe('Live underneath');
});

test('read-cache storage failure cannot block saving a remote confirmation', async () => {
  const first = setup({
    maxBytes: 6000,
    mutate: async () => {
      const writeBatch = first.storage.writeBatch;
      first.storage.writeBatch = async (entries) => {
        if (entries.some(([key]) => key.includes('"cache-v2"'))) {
          throw new Error('Cache unavailable');
        }
        await writeBatch(entries);
      };
      return { __typename: 'Note', id: '1', title: 'x'.repeat(10_000) };
    },
    online: () => true,
  });
  await first.client.request({ note: { id: '1', view: NoteView } });
  await first.session.flush();
  const result = await first.client.mutations.edit({ input: { id: '1', title: 'Small' } });
  expect(result.result?.title).toHaveLength(10_000);
  expect(first.mutate).toHaveBeenCalledTimes(1);
  expect(first.session.getSnapshot().mutations).toHaveLength(0);
  expect(first.session.getSnapshot().error?.message).toBe('Cache unavailable');
});

test('observer exceptions cannot interrupt durable mutation delivery', async () => {
  const { client, mutate, session } = setup({ online: () => true });
  const stop = session.subscribe(() => {
    throw new Error('Broken observer');
  });
  try {
    expect(
      (await client.mutations.edit({ input: { id: '1', title: 'Saved' } })).result?.title,
    ).toBe('Saved');
    expect(mutate).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});

test('queues mutations in invocation order when recovery mixes disk and memory', async () => {
  let online = false;
  const current = setup({ online: () => online });
  await current.session.ready;
  current.client.write('Note', { id: 'child', title: 'Existing' }, new Set(['id', 'title']));
  const parent = current.client.mutations.edit({ input: { id: 'parent', title: 'Create parent' } });
  const child = current.client.mutations.edit({
    input: { id: 'child', title: 'Reference parent' },
  });
  await queued(current.session, 2);
  expect(current.session.getSnapshot().mutations.map((entry) => entry.input)).toEqual([
    { id: 'parent', title: 'Create parent' },
    { id: 'child', title: 'Reference parent' },
  ]);
  online = true;
  current.session.retry();
  await Promise.all([parent, child]);
  expect(current.mutate.mock.calls.map((call) => call[1].id)).toEqual(['parent', 'child']);
});

test('recovers confirmed writes after a cache failure without replaying old receipts later', async () => {
  const first = setup({ online: () => true });
  const request = { note: { id: '1', view: NoteView } };
  await first.client.request(request);
  await first.session.flush();
  const writeBatch = first.storage.writeBatch;
  first.storage.writeBatch = async (entries) => {
    if (entries.some(([key]) => key.includes('"cache-v2"'))) {
      throw new Error('Read cache unavailable');
    }
    await writeBatch(entries);
  };
  const result = await first.client.mutations.edit({ input: { id: '1', title: 'Confirmed' } });
  expect(result.result?.title).toBe('Confirmed');
  await expect(first.session.flush()).rejects.toThrow('Read cache unavailable');
  first.session.dispose();
  first.storage.writeBatch = writeBatch;
  const next = setup({ storage: first.storage });
  next.fetchById.mockRejectedValue(new TypeError('Offline'));
  await next.client.request(request);
  expect(next.client.store.read(noteId)?.title).toBe('Confirmed');
  expect(next.fetchById).not.toHaveBeenCalled();
  next.client.write('Note', { id: '1', title: 'Newer live update' }, new Set(['id', 'title']));
  await next.session.flush();
  next.session.dispose();
  const last = setup({ storage: first.storage });
  await last.client.request(request);
  expect(last.client.store.read(noteId)?.title).toBe('Newer live update');
  expect(last.fetchById).not.toHaveBeenCalled();
});

test('cache recovery never serves a deleted record when repair is unavailable', async () => {
  const first = setup({ mutate: async () => null, online: () => true });
  const request = { note: { id: '1', view: NoteView } };
  await first.client.request(request);
  await first.session.flush();
  const writeBatch = first.storage.writeBatch;
  first.storage.writeBatch = async (entries) => {
    if (entries.some(([key]) => key.includes('"cache-v2"'))) {
      throw new Error('Read cache unavailable');
    }
    await writeBatch(entries);
  };
  await first.client.mutations.edit({ delete: true, input: { id: '1', title: '' } });
  first.session.dispose();
  const next = setup({ storage: first.storage });
  next.fetchById.mockRejectedValue(new TypeError('Offline'));
  await expect(next.client.request(request)).rejects.toThrow('Offline');
  expect(next.client.store.read(noteId)).toBeUndefined();
  first.storage.writeBatch = writeBatch;
  next.fetchById.mockResolvedValue([]);
  await next.client.request(request);
  await next.session.flush();
  expect(next.client.store.read(noteId)).toBeUndefined();
});

test('replaying a receipt preserves newer rollback data for a pending mutation', async () => {
  let online = true;
  const first = setup({ online: () => online });
  await first.client.request({ note: { id: '1', view: NoteView } });
  await first.session.flush();
  const writeBatch = first.storage.writeBatch;
  first.storage.writeBatch = async (entries) => {
    if (entries.some(([key]) => key.includes('"cache-v2"'))) {
      throw new Error('Cache unavailable');
    }
    await writeBatch(entries);
  };
  await first.client.mutations.edit({ input: { id: '1', title: 'Confirmed' } });
  online = false;
  const pending = first.client.mutations
    .edit({
      input: { id: '1', title: 'Pending' },
      optimistic: { title: 'Pending' },
    })
    .catch(() => {});
  await queued(first.session);
  first.client.write('Note', { id: '1', title: 'Newer live update' }, new Set(['id', 'title']));
  await expect(first.session.flush()).rejects.toThrow('Cache unavailable');
  first.session.dispose();
  await pending;
  first.storage.writeBatch = writeBatch;
  const next = setup({ storage: first.storage });
  await next.session.ready;
  await next.session.discard(next.session.getSnapshot().mutations[0].id);
  expect(next.client.store.read(noteId)?.title).toBe('Newer live update');
});

test('startup rechecks recovery receipts after another tab checkpoints newer data', async () => {
  const first = setup({ online: () => true });
  const request = { note: { id: '1', view: NoteView } };
  await first.client.request(request);
  await first.session.flush();
  const writeBatch = first.storage.writeBatch;
  first.storage.writeBatch = async (entries) => {
    if (entries.some(([key]) => key.includes('"cache-v2"'))) {
      throw new Error('Cache unavailable');
    }
    await writeBatch(entries);
  };
  await first.client.mutations.edit({ input: { id: '1', title: 'Confirmed' } });
  first.session.dispose();
  first.storage.writeBatch = writeBatch;
  const exclusive = first.storage.exclusive;
  const started = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  let locks = 0;
  first.storage.exclusive = async (key, run) => {
    // Pause between journal restoration and cache initialization, outside a lock.
    if (key === 'account:1:write' && ++locks === 2) {
      started.resolve();
      await resume.promise;
    }
    return exclusive(key, run);
  };
  const suspended = setup({ storage: first.storage });
  await started.promise;
  const active = setup({ storage: first.storage });
  await active.client.request(request);
  active.client.write('Note', { id: '1', title: 'Newer' }, new Set(['id', 'title']));
  await active.session.flush();
  active.session.dispose();
  resume.resolve();
  await suspended.client.request(request);
  expect(suspended.client.store.read(noteId)?.title).toBe('Newer');
  expect(suspended.fetchById).not.toHaveBeenCalled();
});

test('a rejected admission does not block later mutations', async () => {
  const current = setup({ maxBytes: 6000, online: () => true });
  const rejected = expect(
    current.client.mutations.edit({
      input: { id: '1', title: 'x'.repeat(10_000) },
    }),
  ).rejects.toThrow('size limit');
  const accepted = current.client.mutations.edit({ input: { id: '2', title: 'Saved' } });
  await rejected;
  expect((await accepted).result?.title).toBe('Saved');
  expect(current.mutate).toHaveBeenCalledTimes(1);
});

test('confirmed history releases capacity without an account reset', async () => {
  const current = setup({ maxBytes: 4096, online: () => true });
  for (let index = 0; index < 100; index++) {
    const title = `Edit ${index}`;
    expect((await current.client.mutations.edit({ input: { id: '1', title } })).result?.title).toBe(
      title,
    );
  }
  await current.session.flush();
  expect(current.mutate).toHaveBeenCalledTimes(100);
  expect(await current.storage.scan(`${JSON.stringify(['account:1', 'journal'])}:`)).toEqual([]);
  expect(JSON.stringify(await current.storage.read('account:1')).length).toBeLessThan(150);
});

test.each(['confirm', 'discard'] as const)(
  'a suspended caller safely recovers after local %s cleanup',
  async (outcome) => {
    const storage = memoryStorage();
    const receipts = new Map<string, unknown>();
    let effects = 0;
    let online = false;
    const deliver = async (input: { id: string; title: string }, identity?: MutationIdentity) => {
      if (receipts.has(identity!.id)) {
        return receipts.get(identity!.id);
      }
      if (identity?.replayOnly) {
        throw new FateRequestError('NOT_FOUND', 'No receipt');
      }
      effects++;
      const result = { ...input, __typename: 'Note' };
      receipts.set(identity!.id, result);
      return result;
    };
    const first = setup({
      mutate: deliver,
      online: () => online,
      storage: { ...storage, subscribe: undefined },
    });
    const submission = first.client.mutations.edit({
      input: { id: '1', title: 'Saved' },
      optimistic: { title: 'Saved' },
    });
    const settled = submission.catch((error: Error) => error);
    await queued(first.session);
    const second = setup({ mutate: deliver, online: () => outcome === 'confirm', storage });
    await second.session.ready;
    if (outcome === 'confirm') {
      await queued(second.session, 0);
      await second.session.flush();
    } else {
      await second.session.discard(second.session.getSnapshot().mutations[0].id);
    }
    expect(await storage.scan(`${JSON.stringify(['account:1', 'journal'])}:`)).toEqual([]);
    await second.client.request({ note: { id: '1', view: NoteView } }, { mode: 'network-only' });
    await second.session.flush();
    second.client.write('Note', { id: '1', title: 'Newer' }, new Set(['id', 'title']));
    await second.session.flush();
    expect(
      JSON.stringify(
        await storage.scan(`${JSON.stringify(['account:1', 'cache-v2'])}:`, undefined, 64),
      ),
    ).toContain('Newer');
    second.session.dispose();
    online = true;
    first.session.retry();
    if (outcome === 'confirm') {
      expect(await settled).toMatchObject({ result: { title: 'Saved' } });
    } else {
      expect(await settled).toMatchObject({ message: 'fate: Mutation was discarded.' });
    }
    expect(first.mutate).toHaveBeenCalledTimes(1);
    expect(first.mutate.mock.calls[0][3]).toMatchObject({ replayOnly: true });
    expect(effects).toBe(outcome === 'confirm' ? 1 : 0);
    await first.session.flush();
    expect(
      JSON.stringify(
        await storage.scan(`${JSON.stringify(['account:1', 'cache-v2'])}:`, undefined, 64),
      ),
    ).toContain('Newer');
    const restored = setup({ storage });
    await restored.client.request({ note: { id: '1', view: NoteView } });
    expect(restored.client.store.read(noteId)?.title).toBe('Newer');
  },
);

test('failed discard storage leaves the original caller and optimistic update pending', async () => {
  const current = setup();
  const submission = current.client.mutations
    .edit({ input: { id: '1', title: 'Pending' }, optimistic: { title: 'Pending' } })
    .catch(() => {});
  await queued(current.session);
  const writeBatch = current.storage.writeBatch;
  current.storage.writeBatch = async () => {
    throw new Error('Disk unavailable');
  };
  await expect(
    current.session.discard(current.session.getSnapshot().mutations[0].id),
  ).rejects.toThrow('Disk unavailable');
  expect(current.client.store.read(noteId)?.title).toBe('Pending');
  current.storage.writeBatch = writeBatch;
  await current.session.discard(current.session.getSnapshot().mutations[0].id);
  await submission;
});

test('editing a restored snapshot cannot alter the persisted invocation', async () => {
  const first = setup();
  const submission = first.client.mutations
    .edit({ input: { id: '1', title: 'Original' } })
    .catch(() => {});
  await queued(first.session);
  first.session.dispose();
  await submission;
  let online = false;
  const next = setup({ online: () => online, storage: first.storage });
  await next.session.ready;
  (next.session.getSnapshot().mutations[0].input as { title: string }).title = 'Changed snapshot';
  online = true;
  next.session.retry();
  await queued(next.session, 0);
  expect(next.mutate.mock.calls[0][1].title).toBe('Original');
});

test('a failed local acknowledgement cannot overwrite a newer checkpoint after another tab delivers', async () => {
  const storage = memoryStorage();
  const receipts = new Map<string, unknown>();
  let online = true;
  let unavailable = false;
  const first = setup({
    mutate: async (input, identity) => {
      if (!receipts.has(identity!.id)) {
        receipts.set(identity!.id, { ...input, __typename: 'Note' });
      }
      online = false;
      return receipts.get(identity!.id);
    },
    online: () => online,
    storage: {
      ...storage,
      subscribe: undefined,
      writeBatch: async (entries) => {
        if (
          unavailable &&
          entries.some(
            ([key, value]) =>
              key.includes('"cache-v2"') ||
              (value as { entry?: { status: string } } | undefined)?.entry?.status === 'confirmed',
          )
        ) {
          throw new Error('Suspended storage');
        }
        await storage.writeBatch(entries);
      },
    },
  });
  await first.client.request({ note: { id: '1', view: NoteView } });
  await first.session.flush();
  unavailable = true;
  const submission = first.client.mutations.edit({ input: { id: '1', title: 'Confirmed' } });
  await vi.waitFor(() =>
    expect(first.session.getSnapshot().mutations[0]?.error).toBe('Suspended storage'),
  );
  const second = setup({
    mutate: async (_input, identity) => receipts.get(identity!.id),
    online: () => true,
    storage,
  });
  await second.session.ready;
  await queued(second.session, 0);
  await second.session.flush();
  await second.client.request({ note: { id: '1', view: NoteView } });
  second.client.write('Note', { id: '1', title: 'Newer' }, new Set(['id', 'title']));
  await second.session.flush();
  second.session.dispose();
  unavailable = false;
  online = true;
  first.session.retry();
  expect((await submission).result?.title).toBe('Confirmed');
  await first.session.flush();
  const next = setup({ storage });
  await next.client.request({ note: { id: '1', view: NoteView } });
  expect(next.client.store.read(noteId)?.title).toBe('Newer');
});

test.each([false, true])(
  'cross-tab optimism follows journal order (subscriptions=%s)',
  async (subscriptions) => {
    const storage = memoryStorage();
    if (!subscriptions) {
      storage.subscribe = undefined;
    }
    const first = setup({ storage });
    const second = setup({ storage });
    await Promise.all([first.session.ready, second.session.ready]);
    const older = first.client.mutations
      .edit({ input: { id: '1', title: 'Older' }, optimistic: { title: 'Older' } })
      .catch(() => {});
    await queued(first.session);
    const newer = second.client.mutations
      .edit({ input: { id: '1', title: 'Newer' }, optimistic: { title: 'Newer' } })
      .catch(() => {});
    await queued(second.session, 2);
    expect(second.client.store.read(noteId)?.title).toBe('Newer');
    const latest = first.client.mutations
      .edit({ input: { id: '1', title: 'Latest' }, optimistic: { title: 'Latest' } })
      .catch(() => {});
    await queued(first.session, 3);
    expect(first.session.getSnapshot().mutations.map(({ input }) => input)).toEqual([
      { id: '1', title: 'Older' },
      { id: '1', title: 'Newer' },
      { id: '1', title: 'Latest' },
    ]);
    expect(first.client.store.read(noteId)?.title).toBe('Latest');
    first.session.dispose();
    second.session.dispose();
    await Promise.all([older, newer, latest]);
    const restored = setup({ storage });
    await restored.session.ready;
    expect(restored.client.store.read(noteId)?.title).toBe('Latest');
  },
);
