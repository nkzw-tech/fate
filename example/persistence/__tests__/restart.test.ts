import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, createHTTPTransport, mutation, toEntityId } from '@nkzw/fate';
import { createPersistence, type PersistenceStorage } from '@nkzw/fate/persistence';
import { expect, test, vi } from 'vite-plus/test';
import type { Note } from '../model.ts';
import { createBackend } from '../server.ts';

test('SQLite receipts and the client journal survive losing a response and restarting both sides', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fate-persistence-'));
  const filename = join(directory, 'notes.sqlite');
  let backend = createBackend(filename);
  let online = true;
  let dropNext = false;
  const values = new Map<string, unknown>();
  const locks = new Map<string, Promise<unknown>>();
  const storage: PersistenceStorage = {
    exclusive(key, run) {
      const result = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
      locks.set(key, result);
      return result;
    },
    async read(key) {
      return structuredClone(values.get(key));
    },
    async scan(prefix, after, limit = 64) {
      return [...values.keys()]
        .filter((key) => key.startsWith(prefix) && (!after || key > after))
        .sort()
        .slice(0, limit)
        .map((key) => ({ key, value: structuredClone(values.get(key)) }));
    },
    async write(key, value) {
      values.set(key, structuredClone(value));
    },
    async writeBatch(entries) {
      const copied = structuredClone(entries);
      for (const [key, value] of copied) {
        if (value === undefined) {
          values.delete(key);
        } else {
          values.set(key, value);
        }
      }
    },
  };
  const mutations = {
    like: mutation<Note, { id: string }, Note>('Note'),
    save: mutation<Note, { id: string; title: string }, Note>('Note'),
  };
  const transport = createHTTPTransport<{
    mutations: {
      like: { input: { id: string }; output: Note };
      save: { input: { id: string; title: string }; output: Note };
    };
  }>({
    async fetch(url, init) {
      if (!online) {
        throw new TypeError('Offline');
      }
      const response = await backend.handleRequest(new Request(url, init));
      if (dropNext) {
        dropNext = false;
        online = false;
        throw new TypeError('Connection lost after commit');
      }
      return response;
    },
    headers: { 'x-example-account': 'alice' },
    live: false,
    url: 'http://example.test/api/fate',
  });
  const create = () =>
    createClient<[Record<never, never>, typeof mutations]>({
      mutations,
      persistence: createPersistence({
        key: 'notes:alice',
        online: () => online,
        retryDelay: 20,
        storage,
      }),
      roots: {},
      transport,
      types: [{ fields: { likes: 'scalar', title: 'scalar' }, type: 'Note' }],
    });
  let client = create();
  try {
    const id = crypto.randomUUID();
    await client.mutations.save({ input: { id, title: 'Durable' } });
    dropNext = true;
    const pending = client.mutations
      .like({ input: { id }, optimistic: { likes: 1 } })
      .catch(() => {});
    await vi.waitFor(() =>
      expect(client.persistence!.getSnapshot().mutations[0]?.error).toMatch(/lost after commit/),
    );
    client.persistence!.dispose();
    await pending;
    backend.close();
    backend = createBackend(filename);
    client = create();
    await client.persistence!.ready;
    online = true;
    client.persistence!.retry();
    await vi.waitFor(() => expect(client.persistence!.getSnapshot().mutations).toHaveLength(0));
    const [note] = await transport.fetchById('Note', [id], ['id', 'title', 'likes']);
    expect(note).toMatchObject({ id, likes: 1, title: 'Durable' });
    expect(client.store.read(toEntityId('Note', id))?.likes).toBe(1);
  } finally {
    client.persistence!.dispose();
    backend.close();
    await rm(directory, { force: true, recursive: true });
  }
});
