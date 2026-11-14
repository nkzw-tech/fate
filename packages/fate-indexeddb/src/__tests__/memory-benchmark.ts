import { clientSchema, createClient, dataView, clientRoot, view } from '@nkzw/fate';
import { createPersistence } from '@nkzw/fate/persistence';
import { createIndexedDBStorage } from '../index.ts';

declare global {
  interface Window {
    fateMemoryCheckpoint(): Promise<{
      backingStorageSize: number;
      embedderHeapUsedSize: number;
      totalSize: number;
      usedSize: number;
    }>;
  }
}
const memory = () => window.fateMemoryCheckpoint();
const name = `fate-memory-${crypto.randomUUID()}`;
// No observation arrays retain decoded storage values. Missed notifications
// exercise the same reconciliation path as a suspended tab.
const storage = { ...createIndexedDBStorage({ name }), subscribe: undefined };

const makeRemote = () =>
  createClient({
    persistence: createPersistence({ key: 'remote', maxAge: 3_600_000, storage }),
    roots: { items: clientRoot('Item') },
    transport: {
      fetchById: async () => {
        throw Error('Unexpected network access');
      },
    },
    types: [{ type: 'Item' }],
  });

async function remote() {
  const rows = Array.from({ length: 1000 }, (_, id) => ({ id: String(id), title: `Task ${id}` }));
  const selected = view<any>()({ title: true });
  const request = { items: { ids: rows.map((row) => row.id), view: selected } };
  const seed = async () => {
    const first = createClient({
      persistence: createPersistence({ key: 'remote', maxAge: 3_600_000, storage }),
      roots: { items: clientRoot('Item') },
      transport: { fetchById: async () => rows },
      types: [{ type: 'Item' }],
    });
    await first.persistence!.ready;
    await first.request(request);
    await first.persistence!.flush();
    first.persistence!.dispose();
  };
  await seed();
  const clients: Array<WeakRef<object>> = [];
  let liveHeap: Awaited<ReturnType<typeof memory>> | undefined;
  const run = async (sampleLive = false) => {
    const client = makeRemote();
    await client.persistence!.ready;
    await client.request(request);
    if (client.store.read('Item:999')?.title !== 'Task 999') {
      throw Error('Incorrect restore');
    }
    await client.persistence!.flush();
    if (sampleLive) {
      liveHeap = await memory();
    }
    client.persistence!.dispose();
    clients.push(new WeakRef(client));
  };
  for (let i = 0; i < 10; i++) {
    await run();
  }
  const checkpoints = [await memory()];
  for (let batch = 0; batch < 5; batch++) {
    for (let i = 0; i < 20; i++) {
      await run(batch === 4 && i === 19);
    }
    checkpoints.push(await memory());
  }
  const liveClients = clients.filter((ref) => ref.deref()).length;
  if (liveClients) {
    throw Error(`Retained ${liveClients} disposed clients`);
  }
  return { checkpoints, liveClients, liveHeap, operations: clients.length };
}

async function crossTab() {
  const schema = clientSchema({
    roots: { settings: { id: 'main', type: 'Settings' } },
    types: {
      Document: {
        defaults: (id) => ({ body: '', id }),
        view: dataView<{ body: string; id: string }>('Document')({ body: true, id: true }),
      },
      Settings: {
        defaults: (id) => ({ count: 0, id }),
        view: dataView<{ count: number; id: string }>('Settings')({ count: true, id: true }),
      },
    },
  });
  const make = () =>
    createClient({
      persistence: createPersistence({ key: 'local', maxAge: 0, storage }),
    }).registerClientSchema(schema, ({ mutation }) => ({
      increment: mutation('Settings', {
        resolve: ({ store }) => {
          store.patch('Settings', 'main', {
            count: store.get('Settings', 'main', ['count'])!.count! + 1,
          });
        },
      }),
      seed: mutation('Document', {
        resolve: ({ store }) => {
          for (let id = 0; id < 1000; id++) {
            store.create('Document', { body: 'x'.repeat(4096), id: String(id) });
          }
        },
      }),
    }));
  const first = make();
  await first.persistence!.ready;
  await first.mutations.seed();
  const next = make();
  await next.persistence!.ready;
  const run = async () => {
    await first.mutations.increment();
    await next.mutations.increment();
  };
  for (let i = 0; i < 20; i++) {
    await run();
  }
  const checkpoints = [await memory()];
  for (let batch = 0; batch < 5; batch++) {
    for (let i = 0; i < 100; i++) {
      await run();
    }
    checkpoints.push(await memory());
  }
  if (next.store.read('Settings:main')?.count !== 1040) {
    throw Error('Lost cross-tab update');
  }
  const header = (await storage.read(JSON.stringify(['local', 'client-state-v2']))) as {
    history?: { batches: Array<{ entries: Array<unknown> }> };
  };
  const history = header.history;
  const historyBytes = new TextEncoder().encode(JSON.stringify(history) ?? '').length;
  const historyBatches = history?.batches.length ?? 0;
  const historyEntries =
    history?.batches.reduce((sum, batch) => sum + batch.entries.length, 0) ?? 0;
  if (historyBytes > 16_384 || historyBatches > 16 || historyEntries > 256) {
    throw Error('Unbounded revision history');
  }
  first.persistence!.dispose();
  next.persistence!.dispose();
  return { checkpoints, historyBatches, historyBytes, historyEntries, operations: 1040 };
}
try {
  const results = { crossTab: await crossTab(), released: await memory(), remote: await remote() };
  document.getElementById('output')!.textContent = JSON.stringify(results);
} catch (error) {
  document.getElementById('output')!.textContent = JSON.stringify({
    error: String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
} finally {
  document.getElementById('output')!.dataset.done = 'true';
  indexedDB.deleteDatabase(name);
}
