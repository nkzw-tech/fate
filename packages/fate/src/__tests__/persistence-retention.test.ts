import { afterEach, expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import type { PersistenceSession } from '../persistence-types.ts';
import { createPersistence } from '../persistence.ts';
import { clientRoot } from '../root.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

type Note = { __typename: 'Note'; body: string; id: string; title: string };
const Title = view<Note>()({ id: true, title: true });
const Detail = view<Note>()({ body: true, id: true, title: true });
const DAY = 86_400_000;
const sessions: Array<PersistenceSession> = [];
afterEach(() => {
  for (const session of sessions.splice(0)) {
    session.dispose();
  }
  vi.restoreAllMocks();
});
const setup = ({
  maxAge = DAY,
  maxBytes = 25 * 1024 * 1024,
  offline = false,
  storage = memoryStorage(),
  title = 'Saved',
} = {}) => {
  const fetchById = vi.fn(async (_type: string, ids: Array<string | number>) => {
    if (offline) {
      throw new TypeError('Offline');
    }
    return ids.map((id) => ({ __typename: 'Note', body: `Body ${id}`, id: String(id), title }));
  });
  const roots = { note: clientRoot('Note') };
  const client = createClient<[typeof roots, Record<never, never>]>({
    gcReleaseBufferSize: 0,
    persistence: createPersistence({
      key: 'retention',
      maxAge,
      maxBytes,
      online: () => false,
      storage,
    }),
    roots,
    transport: { fetchById },
    types: [{ fields: { body: 'scalar', title: 'scalar' }, type: 'Note' }],
  });
  const session = client.persistence!;
  sessions.push(session);
  return { client, fetchById, session, storage };
};
const request = (id: string) => ({ note: { id, view: Title } });
const nestedScalar = () => {
  let value: unknown = 'leaf';
  for (let depth = 0; depth < 40; depth++) {
    value = { child: value };
  }
  return value;
};
const clock = () => {
  let now = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  return (duration: number) => {
    now += duration;
  };
};

test('disk survives memory GC and startup does not restore unrelated records', async () => {
  const first = setup();
  await first.client.request(request('1'));
  await first.client.request(request('2'));
  await first.session.flush();
  first.client.gc();
  expect(first.client.store.read('Note:1')).toBeUndefined();
  first.session.dispose();
  const next = setup({ offline: true, storage: first.storage });
  await next.session.ready;
  expect(next.client.store.dehydrate().records).toHaveLength(0);
  await next.client.request(request('1'));
  expect(next.client.store.dehydrate().records).toHaveLength(1);
  expect(next.fetchById).not.toHaveBeenCalled();
});

test('one-day default expires on restore; offline reads do not renew it', async () => {
  const advance = clock();
  const first = setup();
  await first.client.request(request('1'));
  await first.session.flush();
  first.session.dispose();
  advance(DAY / 2);
  const middle = setup({ offline: true, storage: first.storage });
  await middle.client.request(request('1'));
  await middle.session.flush();
  middle.session.dispose();
  advance(DAY / 2);
  const last = setup({ offline: true, storage: first.storage });
  await expect(last.client.request(request('1'))).rejects.toThrow('Offline');
});

test('overlapping requests retain a single shared record and expire unneeded fields', async () => {
  const advance = clock();
  const first = setup();
  await first.client.request({ note: { id: '1', view: Detail } });
  await first.client.request(request('1'), { persist: { maxAge: 3 * DAY } });
  await first.session.flush();
  const entries = await first.storage.scan('["retention","cache-v2"', undefined, 1000);
  expect(entries.filter(({ key }) => key.includes(':node:r:'))).toHaveLength(1);
  first.session.dispose();
  advance(2 * DAY);
  const next = setup({ offline: true, storage: first.storage });
  await next.client.request(request('1'));
  expect(next.fetchById).not.toHaveBeenCalled();
  expect(next.client.store.dehydrate().records[0][1].body).toBeUndefined();
  await expect(next.client.request({ note: { id: '1', view: Detail } })).rejects.toThrow('Offline');
});

test('reload shows cached data and updates it after background network refresh', async () => {
  const first = setup();
  await first.client.request(request('1'));
  await first.session.flush();
  first.session.dispose();
  const next = setup({ storage: first.storage });
  const retain = next.client.retain(request('1'));
  const response = Promise.withResolvers<Array<Note>>();
  next.fetchById.mockImplementation(() => response.promise);
  const refs = await next.client.request(request('1'), { mode: 'stale-while-revalidate' });
  expect((await next.client.readView(Title, refs.note)).data).toMatchObject({ title: 'Saved' });
  response.resolve([{ __typename: 'Note', body: 'New', id: '1', title: 'Fresh' }]);
  await vi.waitFor(() => expect(next.client.store.dehydrate().records[0]?.[1].title).toBe('Fresh'));
  await next.session.flush();
  retain.dispose();
  next.session.dispose();
  const last = setup({ offline: true, storage: first.storage });
  const saved = await last.client.request(request('1'));
  expect((await last.client.readView(Title, saved.note)).data).toMatchObject({ title: 'Fresh' });
});

test('network-only still requires the network despite a saved cache', async () => {
  const first = setup();
  await first.client.request(request('1'));
  await first.session.flush();
  first.session.dispose();
  const next = setup({ offline: true, storage: first.storage });
  await expect(next.client.request(request('1'), { mode: 'network-only' })).rejects.toThrow(
    'Offline',
  );
});

test('zero retention bypasses disk and invalid overrides fail before fetching', async () => {
  const first = setup();
  expect(() => first.client.request(request('1'), { persist: { maxAge: Number.NaN } })).toThrow(
    'maxAge',
  );
  expect(first.fetchById).not.toHaveBeenCalled();
  await first.client.request(request('1'), { persist: { maxAge: 0 } });
  await first.session.flush();
  first.session.dispose();
  const next = setup({ offline: true, storage: first.storage });
  await expect(next.client.request(request('1'))).rejects.toThrow('Offline');
});

test('oversized responses remain usable in memory but are never admitted to disk', async () => {
  const storage = memoryStorage();
  const writeBatch = storage.writeBatch;
  let peak = 0;
  storage.writeBatch = async (entries) => {
    await writeBatch(entries);
    const saved = await storage.scan('["retention","cache-v2"', undefined, 10_000);
    peak = Math.max(
      peak,
      saved.reduce((sum, { value }) => sum + ((value as { bytes?: number }).bytes ?? 0), 0),
    );
  };
  const first = setup({ maxBytes: 4096, storage, title: 'x'.repeat(10_000) });
  const retain = first.client.retain(request('1'));
  const refs = await first.client.request(request('1'));
  await first.session.flush();
  expect((await first.client.readView(Title, refs.note)).data).toMatchObject({
    title: 'x'.repeat(10_000),
  });
  expect(peak).toBeLessThanOrEqual(4096);
  retain.dispose();
  first.session.dispose();
  const next = setup({ maxBytes: 4096, offline: true, storage });
  await expect(next.client.request(request('1'))).rejects.toThrow('Offline');
});

test('size pressure evicts the least recently used request', async () => {
  const advance = clock();
  const first = setup({ maxBytes: 6500, title: 'x'.repeat(2000) });
  await first.client.request(request('1'));
  await first.session.flush();
  advance(100);
  await first.client.request(request('2'));
  await first.session.flush();
  first.session.dispose();
  const next = setup({ maxBytes: 6500, offline: true, storage: first.storage });
  await next.client.request(request('2'));
  expect(next.fetchById).not.toHaveBeenCalled();
  await expect(next.client.request(request('1'))).rejects.toThrow('Offline');
});

test('confirmed updates and deletions are persisted without renewing request age', async () => {
  const advance = clock();
  const first = setup();
  const retain = first.client.retain(request('1'));
  await first.client.request(request('1'));
  await first.session.flush();
  advance(DAY / 2);
  first.client.write('Note', { id: '1', title: 'Updated' }, new Set(['id', 'title']));
  await first.session.flush();
  const next = setup({ offline: true, storage: first.storage });
  const refs = await next.client.request(request('1'));
  expect((await next.client.readView(Title, refs.note)).data).toMatchObject({ title: 'Updated' });
  first.client.deleteRecord('Note', '1');
  await first.session.flush();
  const last = setup({ offline: true, storage: first.storage });
  await expect(last.client.request(request('1'))).rejects.toThrow('Offline');
  retain.dispose();
});

test.each([{ maxAge: -1 }, { maxAge: Infinity }, { maxBytes: 0 }, { maxBytes: 1.5 }])(
  'validates persistence limits %s',
  (limits) => {
    expect(() => createPersistence({ key: 'test', storage: memoryStorage(), ...limits })).toThrow();
  },
);

test('root lists, nested records and pagination survive reload and an unloaded deletion', async () => {
  type Author = { __typename: 'Author'; id: string; name: string };
  type Post = { __typename: 'Post'; author: Author; id: string; title: string };
  const AuthorView = view<Author>()({ id: true, name: true });
  const PostView = view<Post>()({ author: AuthorView, id: true, title: true });
  const storage = memoryStorage();
  const roots = { posts: clientRoot('Post') };
  const page = {
    posts: {
      list: {
        items: { cursor: true, node: PostView },
        pagination: { hasNext: true, hasPrevious: true },
      },
    },
  };
  const create = (offline = false) => {
    const fetchList = vi.fn(async () => {
      if (offline) {
        throw new TypeError('Offline');
      }
      return {
        items: ['1', '2'].map((id) => ({
          cursor: `cursor-${id}`,
          node: {
            __typename: 'Post',
            author: { __typename: 'Author', id: 'shared', name: 'Writer' },
            id,
            title: id,
          },
        })),
        pagination: { hasNext: false, hasPrevious: false },
      };
    });
    const client = createClient<[typeof roots, Record<never, never>]>({
      gcReleaseBufferSize: 0,
      persistence: createPersistence({ key: 'nested', online: () => false, storage }),
      roots,
      transport: {
        fetchById: async () => {
          throw new TypeError('Offline');
        },
        fetchList,
      },
      types: [
        { fields: { author: { type: 'Author' }, title: 'scalar' }, type: 'Post' },
        { fields: { name: 'scalar' }, type: 'Author' },
      ],
    });
    sessions.push(client.persistence!);
    return { client, fetchList, session: client.persistence! };
  };
  const first = create();
  await first.client.request(page);
  await first.session.flush();
  first.client.gc();
  expect(first.client.store.dehydrate().records).toHaveLength(0);
  first.client.deleteRecord('Post', '1');
  await first.session.flush();
  first.session.dispose();
  const next = create(true);
  await next.client.request(page);
  expect(next.fetchList).not.toHaveBeenCalled();
  const state = next.client.store.dehydrate();
  expect(state.records).toHaveLength(2);
  expect(state.records.some(([, record]) => record.name === 'Writer')).toBe(true);
  expect(state.lists[0][1]).toMatchObject({
    cursors: ['cursor-2'],
    pagination: { hasNext: false },
  });
});

test('scalar updates write only their normalized record, not every retained request', async () => {
  const first = setup();
  const retain = first.client.retain(request('1'));
  for (let index = 0; index < 20; index++) {
    await first.client.request(request(String(index)));
  }
  await first.session.flush();
  const writes = vi.spyOn(first.storage, 'writeBatch');
  first.client.write('Note', { id: '1', title: 'New' }, new Set(['id', 'title']));
  await first.session.flush();
  const keys = writes.mock.calls.flatMap(([entries]) => entries.map(([key]) => key));
  expect(keys.filter((key) => key.includes(':node:r:'))).toHaveLength(1);
  expect(keys.some((key) => key.includes(':root:'))).toBe(false);
  retain.dispose();
});

test('deep scalar updates do not inspect references or rewrite request roots', async () => {
  const first = setup();
  const detail = { note: { id: '1', view: Detail } };
  const retain = first.client.retain(detail);
  await first.client.request(detail);
  await first.session.flush();
  const writes = vi.spyOn(first.storage, 'writeBatch');
  const body = nestedScalar();
  first.client.write('Note', { body, id: '1' }, new Set(['id', 'body']));
  await first.session.flush();
  const keys = writes.mock.calls.flatMap(([entries]) => entries.map(([key]) => key));
  expect(keys.filter((key) => key.includes(':node:r:'))).toHaveLength(1);
  expect(keys.some((key) => key.includes(':root:'))).toBe(false);
  retain.dispose();
  first.session.dispose();
  const next = setup({ offline: true, storage: first.storage });
  await next.client.request(detail);
  expect(next.client.store.read('Note:1')?.body).toEqual(body);
});

test('large cache writes yield to the page and use bounded storage batches', async () => {
  const first = setup();
  const writeBatch = vi.spyOn(first.storage, 'writeBatch');
  for (let index = 0; index < 80; index++) {
    await first.client.request(request(String(index)));
  }
  let done = false;
  const flushing = first.session.flush().then(() => {
    done = true;
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(done).toBe(false);
  await flushing;
  expect(writeBatch.mock.calls.every(([entries]) => entries.length <= 65)).toBe(true);
});

test('updates during a slow flush coalesce into one follow-up flush', async () => {
  const first = setup();
  await first.client.request(request('1'));
  await first.session.flush();
  const writeBatch = first.storage.writeBatch;
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  let blocked = false;
  first.storage.writeBatch = async (entries) => {
    if (!blocked && entries.some(([key]) => key.includes(':node:r:'))) {
      blocked = true;
      entered.resolve();
      await resume.promise;
    }
    await writeBatch(entries);
  };
  const exclusive = vi.spyOn(first.storage, 'exclusive');
  first.client.write('Note', { id: '1', title: 'First' }, new Set(['id', 'title']));
  const initial = first.session.flush();
  await entered.promise;
  const concurrent: Array<Promise<void>> = [];
  for (let index = 0; index < 20; index++) {
    first.client.write('Note', { id: '1', title: `Update ${index}` }, new Set(['id', 'title']));
    concurrent.push(first.session.flush());
  }
  resume.resolve();
  await Promise.all([initial, ...concurrent]);
  expect(exclusive.mock.calls.filter(([key]) => key === 'retention:write')).toHaveLength(2);
  first.session.dispose();
  const next = setup({ offline: true, storage: first.storage });
  const refs = await next.client.request(request('1'));
  expect((await next.client.readView(Title, refs.note)).data).toMatchObject({
    title: 'Update 19',
  });
});

test('eviction batches node updates and byte accounting', async () => {
  const first = setup();
  const many = {
    note: { ids: Array.from({ length: 80 }, (_, index) => String(index)), view: Title },
  };
  await first.client.request(many);
  await first.session.flush();
  const writeBatch = vi.spyOn(first.storage, 'writeBatch');
  await first.client.request(many, { persist: { maxAge: 0 } });
  await first.session.flush();
  const nodeBatches = writeBatch.mock.calls.filter(([entries]) =>
    entries.some(([key]) => key.includes(':node:r:')),
  );
  expect(nodeBatches).toHaveLength(2);
  expect(nodeBatches.every(([entries]) => entries.length <= 65)).toBe(true);
});

test('a retention override also applies to an already fulfilled request handle', async () => {
  const advance = clock();
  const first = setup();
  await first.client.request(request('1'));
  await first.session.flush();
  await first.client.request(request('1'), { persist: { maxAge: 3 * DAY } });
  await first.session.flush();
  first.session.dispose();
  advance(2 * DAY);
  const next = setup({ offline: true, storage: first.storage });
  await next.client.request(request('1'), { persist: { maxAge: 3 * DAY } });
  expect(next.fetchById).not.toHaveBeenCalled();
});

test('fetching one missing ID does not renew the other IDs in a request', async () => {
  const advance = clock();
  const first = setup();
  const retain = first.client.retain(request('1'));
  await first.client.request(request('1'));
  await first.session.flush();
  advance(DAY / 2);
  await first.client.request({ note: { ids: ['1', '2'], view: Title } });
  expect(first.fetchById.mock.calls[1][1]).toEqual(['2']);
  await first.session.flush();
  retain.dispose();
  first.session.dispose();
  advance(DAY / 2);
  const next = setup({ offline: true, storage: first.storage });
  await next.client.request(request('2'));
  await expect(next.client.request(request('1'))).rejects.toThrow('Offline');
});

test('failed cache batches retain snapshots for a later flush after memory GC', async () => {
  const first = setup();
  await first.client.request(request('1'));
  const writeBatch = first.storage.writeBatch;
  const failed = vi.spyOn(first.storage, 'writeBatch').mockRejectedValue(new Error('Disk busy'));
  await expect(first.session.flush()).rejects.toThrow('Disk busy');
  first.client.gc();
  failed.mockImplementation(writeBatch);
  await first.session.flush();
  first.session.dispose();
  const next = setup({ offline: true, storage: first.storage });
  await next.client.request(request('1'));
  expect(next.fetchById).not.toHaveBeenCalled();
});

test('disposing during a disk read cannot restore data or start a network request', async () => {
  const first = setup();
  await first.client.request(request('1'));
  await first.session.flush();
  first.session.dispose();
  const next = setup({ storage: first.storage });
  await next.session.ready;
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const read = first.storage.read;
  vi.spyOn(first.storage, 'read').mockImplementation(async (key) => {
    const value = await read(key);
    if (key.includes(':node:r:')) {
      entered.resolve();
      await resume.promise;
    }
    return value;
  });
  const pending = next.client.request(request('1'));
  const rejected = expect(pending).rejects.toThrow('disposed');
  await entered.promise;
  next.session.dispose();
  resume.resolve();
  await rejected;
  expect(next.client.store.read('Note:1')).toBeUndefined();
  expect(next.fetchById).not.toHaveBeenCalled();
});

test('restoration merges embedded fields without replacing newer memory values', async () => {
  const { client, session } = setup();
  await session.ready;
  client.store.merge('Note:1', { body: { fresh: 'memory' }, id: '1' }, ['id', 'body.fresh']);
  client.restorePersistenceData({
    rootLists: [],
    rootRequests: [],
    store: {
      coverage: [['Note:1', ['id', 'body.fresh', 'body.saved']]],
      lists: [],
      records: [['Note:1', { body: { fresh: 'old', saved: 'disk' }, id: '1' }]],
    },
  });
  expect(client.store.read('Note:1')?.body).toEqual({ fresh: 'memory', saved: 'disk' });
});

test('an oversized response does not evict other requests that fit the budget', async () => {
  const first = setup({ maxBytes: 6500 });
  await first.client.request(request('1'));
  await first.session.flush();
  first.fetchById.mockResolvedValue([
    { __typename: 'Note', body: '', id: '2', title: 'x'.repeat(10_000) },
  ]);
  await first.client.request(request('2'));
  await first.session.flush();
  first.session.dispose();
  const next = setup({ maxBytes: 6500, offline: true, storage: first.storage });
  await next.client.request(request('1'));
  expect(next.fetchById).not.toHaveBeenCalled();
});

test('a second tab changing one field preserves the latest saved values of other fields', async () => {
  const first = setup();
  const detail = { note: { id: '1', view: Detail } };
  const retainFirst = first.client.retain(detail);
  await first.client.request(detail);
  await first.session.flush();
  const second = setup({ offline: true, storage: first.storage });
  const retainSecond = second.client.retain(detail);
  await second.client.request(detail);
  first.client.write('Note', { id: '1', title: 'New title' }, new Set(['id', 'title']));
  await first.session.flush();
  second.client.write('Note', { body: 'New body', id: '1' }, new Set(['id', 'body']));
  await second.session.flush();
  const next = setup({ offline: true, storage: first.storage });
  await next.client.request(detail);
  expect(next.client.store.read('Note:1')).toMatchObject({ body: 'New body', title: 'New title' });
  retainFirst.dispose();
  retainSecond.dispose();
});

test('a failed disk lookup reports the error and falls back to the network', async () => {
  const first = setup();
  await first.client.request(request('1'));
  await first.session.flush();
  first.session.dispose();
  const read = first.storage.read;
  const readCache = vi.spyOn(first.storage, 'read').mockImplementation((key) => {
    if (key.includes(':node:r:')) {
      return Promise.reject(new Error('Unreadable cache'));
    }
    return read(key);
  });
  const next = setup({ storage: first.storage, title: 'Network' });
  await next.client.request(request('1'));
  expect(next.fetchById).toHaveBeenCalledTimes(1);
  expect(next.client.store.read('Note:1')?.title).toBe('Network');
  expect(next.session.getSnapshot().error?.message).toBe('Unreadable cache');
  readCache.mockRestore();
  await next.session.flush();
  expect(next.session.getSnapshot().error).toBeUndefined();
});

test('a cached read preserves a newer fetch age despite older overlapping claims', async () => {
  const advance = clock();
  const first = setup();
  await first.client.request(request('1'), { persist: { maxAge: 3 * DAY } });
  await first.session.flush();
  advance(DAY / 2);
  const detail = { note: { id: '1', view: Detail } };
  await first.client.request(detail, { mode: 'network-only' });
  await first.session.flush();
  first.session.dispose();
  advance(DAY / 4);
  const second = setup({ offline: true, storage: first.storage });
  await second.client.request(detail);
  await second.session.flush();
  second.session.dispose();
  advance(DAY / 2);
  const third = setup({ offline: true, storage: first.storage });
  await expect(third.client.request(detail)).resolves.toBeDefined();
  expect(third.fetchById).not.toHaveBeenCalled();
  third.session.dispose();
  advance(DAY / 4);
  const expired = setup({ offline: true, storage: first.storage });
  await expect(expired.client.request(detail)).rejects.toThrow('Offline');
});

test.each(['cache-first', 'network-only', 'stale-while-revalidate'] as const)(
  'retention overrides apply during a pending %s request',
  async (mode) => {
    const advance = clock();
    const first = setup();
    const response = Promise.withResolvers<Array<Note>>();
    first.fetchById.mockImplementation(() => response.promise);
    const normal = first.client.request(request('1'), { mode });
    await vi.waitFor(() => expect(first.fetchById).toHaveBeenCalledTimes(1));
    const extended = first.client.request(request('1'), { mode, persist: { maxAge: 3 * DAY } });
    response.resolve([{ __typename: 'Note', body: 'Body', id: '1', title: 'Saved' }]);
    await Promise.all([normal, extended]);
    await first.session.flush();
    expect(first.fetchById).toHaveBeenCalledTimes(1);
    first.session.dispose();
    advance(2 * DAY);
    const next = setup({ offline: true, storage: first.storage });
    await expect(next.client.request(request('1'))).resolves.toBeDefined();
  },
);

test('zero retention overrides an in-flight request before it reaches disk', async () => {
  const first = setup();
  const response = Promise.withResolvers<Array<Note>>();
  first.fetchById.mockImplementation(() => response.promise);
  const normal = first.client.request(request('1'));
  const skipped = first.client.request(request('1'), { persist: { maxAge: 0 } });
  response.resolve([{ __typename: 'Note', body: 'Body', id: '1', title: 'Saved' }]);
  await Promise.all([normal, skipped]);
  await first.session.flush();
  first.session.dispose();
  const next = setup({ offline: true, storage: first.storage });
  await expect(next.client.request(request('1'))).rejects.toThrow('Offline');
});
