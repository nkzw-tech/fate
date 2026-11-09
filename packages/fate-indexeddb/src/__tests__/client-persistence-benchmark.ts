import { clientSchema, createClient, dataView } from '@nkzw/fate';
import { createPersistence, type PersistenceStorage } from '@nkzw/fate/persistence';
import { createIndexedDBStorage } from '../index.ts';

const params = new URLSearchParams(location.search);
const recordCount = Number(params.get('records') ?? 100);
const sampleCount = Number(params.get('samples') ?? 15);
const output = document.querySelector('pre')!;
const encoder = new TextEncoder();
const size = (entries: ReadonlyArray<readonly [string, unknown]>) =>
  entries.reduce((bytes, entry) => bytes + encoder.encode(JSON.stringify(entry)).length, 0);

const data = Array.from({ length: recordCount }, (_, id) => ({
  history: JSON.stringify(
    Array.from({ length: 2400 }, (_, index) => [index, (id + index * 71) % 256, index % 17, id]),
  ),
  id: String(id),
  state: JSON.stringify(
    Array.from({ length: 3000 }, (_, index) => [
      index % 64,
      index >> 6,
      (index * 43 + id) % 251,
      id,
    ]),
  ),
}));
const schema = clientSchema({
  roots: { settings: { id: 'main', type: 'Settings' } },
  types: {
    Document: {
      defaults: (id) => ({ history: '', id, state: '' }),
      view: dataView<{ history: string; id: string; state: string }>('Document')({
        history: true,
        id: true,
        state: true,
      }),
    },
    Settings: {
      defaults: (id) => ({ count: 0, id }),
      view: dataView<{ count: number; id: string }>('Settings')({ count: true, id: true }),
    },
  },
});
const isClientStateKey = (key: string) => key.includes('"client-state-v');
const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const samples = async (count: number, run: () => Promise<Sample>) => {
  const values: Array<Sample> = [];
  for (let index = 0; index < count; index++) {
    values.push(await run());
  }
  return values;
};
type Sample = { elapsedMs: number; maxFrameGapMs: number; readBytes: number; writeBytes: number };

let history = data[0]?.history ?? '';

const make = (storage: PersistenceStorage, key: string) =>
  createClient({
    persistence: createPersistence({ key, maxAge: 0, storage }),
  }).registerClientSchema(schema, ({ mutation }) => ({
    importDocuments: mutation('Document', {
      resolve: ({ store }) => {
        for (const row of data) {
          store.create('Document', row);
        }
      },
    }),
    saveHistory: mutation('Document', {
      resolve: ({ store }) => store.update('Document', '0', { history }),
    }),
    updateSettings: mutation('Settings', {
      resolve: ({ store }) =>
        store.update('Settings', 'main', { count: store.get('Settings', 'main')!.count! + 1 }),
    }),
  }));

async function benchmark() {
  const name = `fate-client-benchmark-${crypto.randomUUID()}`;
  const disk = createIndexedDBStorage({ name });
  let reads: Array<readonly [string, unknown]> = [];
  let writes: Array<readonly [string, unknown]> = [];
  const storage: PersistenceStorage = {
    ...disk,
    async read(key) {
      const value = await disk.read(key);
      if (value !== undefined && isClientStateKey(key)) {
        reads.push([key, value]);
      }
      return value;
    },
    async scan(prefix, after, limit) {
      const entries = await disk.scan(prefix, after, limit);
      for (const { key, value } of entries) {
        if (isClientStateKey(key)) {
          reads.push([key, value]);
        }
      }
      return entries;
    },
    async writeBatch(batch) {
      for (const [key, value] of batch) {
        if (isClientStateKey(key)) {
          writes.push([key, value]);
        }
      }
      await disk.writeBatch(batch);
    },
  };
  const measure = async (run: () => Promise<unknown>): Promise<Sample> => {
    let last = await frame();
    let maxFrameGapMs = 0;
    const tick = (time: number) => {
      maxFrameGapMs = Math.max(maxFrameGapMs, time - last);
      last = time;
      request = requestAnimationFrame(tick);
    };
    let request = requestAnimationFrame(tick);
    reads = [];
    writes = [];
    const start = performance.now();
    let elapsedMs: number;
    try {
      await run();
      elapsedMs = performance.now() - start;
      await frame();
    } finally {
      cancelAnimationFrame(request);
    }
    // Count encoded bytes after timing so instrumentation does not serialize the payload twice.
    return { elapsedMs, maxFrameGapMs, readBytes: size(reads), writeBytes: size(writes) };
  };

  const bulkImport = await samples(Math.min(sampleCount, 5), async () => {
    const client = make(storage, crypto.randomUUID());
    try {
      await client.persistence!.ready;
      return await measure(() => client.mutations.importDocuments());
    } finally {
      client.persistence!.dispose();
    }
  });
  const client = make(storage, 'library');
  try {
    await client.mutations.importDocuments();
    const settings = await samples(sampleCount, () =>
      measure(() => client.mutations.updateSettings()),
    );
    let revision = 0;
    const saveHistory = await samples(sampleCount, () => {
      // Whitespace changes the encoded save while preserving its JSON structure.
      history = data[0].history + ' '.repeat(++revision);
      return measure(() => client.mutations.saveHistory());
    });
    const coldRestore = await samples(sampleCount, () =>
      measure(async () => {
        const reopened = make(storage, 'library');
        try {
          await reopened.persistence!.ready;
          if (reopened.store.read('Document:0')?.history !== history) {
            throw new Error('Restored document differs from the last saved value.');
          }
        } finally {
          reopened.persistence!.dispose();
        }
      }),
    );
    return { bulkImport, coldRestore, recordCount, saveHistory, settings };
  } finally {
    client.persistence!.dispose();
    indexedDB.deleteDatabase(name);
  }
}

try {
  if (
    !Number.isSafeInteger(recordCount) ||
    recordCount < 1 ||
    !Number.isSafeInteger(sampleCount) ||
    sampleCount < 1
  ) {
    throw new Error('Record and sample counts must be positive integers.');
  }
  output.textContent = JSON.stringify(await benchmark(), null, 2);
  output.dataset.status = 'done';
} catch (error) {
  output.textContent = String(error);
  output.dataset.status = 'error';
}
