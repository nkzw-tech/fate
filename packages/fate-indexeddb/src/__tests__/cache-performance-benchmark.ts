import { clientSchema, createClient, dataView, clientRoot, view } from '@nkzw/fate';
import { createPersistence } from '@nkzw/fate/persistence';
import { createIndexedDBStorage } from '../index.ts';
const p50 = (values: Array<number>) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const name = `fate-audit-${crypto.randomUUID()}`;
const params = new URLSearchParams(location.search);
const sampleCount = Number(params.get('samples') ?? 7);
const disk = createIndexedDBStorage({ name });
let readCalls = 0,
  scans = 0,
  active = 0,
  peak = 0,
  readEntries: Array<any> = [];
const storage = {
  ...disk,
  // Simulate a suspended tab that missed BroadcastChannel messages; reconciliation must still work.
  async read(key: string) {
    readCalls++;
    peak = Math.max(peak, ++active);
    try {
      const result = await disk.read(key);
      readEntries.push([key, result]);
      return result;
    } finally {
      active--;
    }
  },
  async readMany(keys: ReadonlyArray<string>) {
    readCalls++;
    const values = disk.readMany
      ? await disk.readMany(keys)
      : await Promise.all(keys.map((key) => disk.read(key)));
    readEntries.push(...keys.map((key, index) => [key, values[index]]));
    return values;
  },
  async scan(...args: Parameters<typeof disk.scan>) {
    scans++;
    const entries = await disk.scan(...args);
    readEntries.push(...entries);
    return entries;
  },
  subscribe: undefined,
};
if (!disk.readMany) {
  delete (storage as { readMany?: unknown }).readMany;
}
const reset = () => {
  readCalls = 0;
  scans = 0;
  peak = 0;
  readEntries = [];
};
const stats = () => ({
  claimKeyCharacters: readEntries.reduce(
    (sum, entry) =>
      sum +
      Object.keys(entry?.[1]?.value?.claims ?? {}).reduce((size, key) => size + key.length, 0),
    0,
  ),
  peak,
  readBytes: new TextEncoder().encode(JSON.stringify(readEntries)).length,
  readCalls,
  scans,
});

async function remote(n: number, mode: 'ids' | 'graph' = 'ids') {
  const key = `remote-${mode}-${n}`;
  const rows = Array.from({ length: n }, (_, id) => ({ id: String(id), title: `Task ${id}` }));
  const selection =
    mode === 'ids'
      ? view<any>()({ id: true, title: true })
      : view<{
          __typename: 'Parent';
          id: string;
          items: Array<{ __typename: 'Item'; id: string; title: string }>;
        }>()({ items: { id: true, title: true } });
  let network = 0;
  const make = () =>
    createClient({
      persistence: createPersistence({ key, maxAge: 3_600_000, storage }),
      roots: { items: clientRoot(mode === 'ids' ? 'Item' : 'Parent') },
      transport: {
        fetchById: async () => {
          network++;
          return mode === 'ids' ? rows : [{ id: 'main', items: rows }];
        },
      },
      types: [
        { type: 'Item' },
        { fields: { items: { array: true, listOf: 'Item' } }, type: 'Parent' },
      ],
    });
  const request = {
    items:
      mode === 'ids'
        ? { ids: rows.map((r) => r.id), view: selection }
        : { id: 'main', view: selection },
  };
  const first = make();
  await first.persistence!.ready;
  await first.request(request);
  await first.persistence!.flush();
  first.persistence!.dispose();
  const samples = [];
  for (let i = 0; i < sampleCount + 1; i++) {
    const next = make();
    await next.persistence!.ready;
    reset();
    network = 0;
    const start = performance.now();
    await next.request(request);
    const elapsed = performance.now() - start;
    if (network || next.store.read(`Item:${n - 1}`)?.title !== `Task ${n - 1}`) {
      throw Error('Remote cache restore failed');
    }
    const result = { elapsed, ...stats() };
    await next.persistence!.flush();
    next.persistence!.dispose();
    if (i) {
      samples.push(result);
    }
  }
  return { medianMs: p50(samples.map((s) => s.elapsed)), mode, n, samples };
}

async function crossTab(n: number) {
  const key = `local-${n}`;
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
      persistence: createPersistence({ key, maxAge: 0, storage }),
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
          for (let id = 0; id < n; id++) {
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
  const own = [],
    other = [];
  for (let i = 0; i < sampleCount + 1; i++) {
    reset();
    let start = performance.now();
    await next.mutations.increment();
    const a = { elapsed: performance.now() - start, ...stats() };
    await first.mutations.increment();
    reset();
    start = performance.now();
    await next.mutations.increment();
    const b = { elapsed: performance.now() - start, ...stats() };
    if (next.store.read('Settings:main')?.count !== (i + 1) * 3) {
      throw Error('Cross-tab counter lost update');
    }
    if (i) {
      own.push(a);
      other.push(b);
    }
  }
  first.persistence!.dispose();
  next.persistence!.dispose();
  return {
    afterOtherTab: { medianMs: p50(other.map((s) => s.elapsed)), samples: other },
    n,
    sameTab: { medianMs: p50(own.map((s) => s.elapsed)), samples: own },
  };
}

try {
  const results: {
    crossTab: Array<Awaited<ReturnType<typeof crossTab>>>;
    remote: Array<Awaited<ReturnType<typeof remote>>>;
  } = { crossTab: [], remote: [] };
  for (const n of [100, 1000]) {
    for (const mode of ['ids', 'graph'] as const) {
      results.remote.push(await remote(n, mode));
    }
  }
  for (const n of [100, 1000]) {
    results.crossTab.push(await crossTab(n));
  }
  document.getElementById('output')!.textContent = JSON.stringify(results, null, 2);
} catch (error) {
  document.getElementById('output')!.textContent = JSON.stringify({
    error: String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
} finally {
  document.getElementById('output')!.dataset.done = 'true';
  indexedDB.deleteDatabase(name);
}
