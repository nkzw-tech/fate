import { createClient } from '../client.ts';
import { createClientStateFixture, type State } from './fixtures/client-state.ts';

// Run through scripts/benchmark-client-state.mjs; excluded from normal tests.
const params = new URLSearchParams(location.search);
const recordCount = Number(params.get('records') ?? 1000);
const sampleCount = Number(params.get('samples') ?? 30);
const output = document.querySelector('pre')!;
const {
  computedView,
  countPaths,
  graphView,
  items,
  largeSchema,
  make,
  makeCore,
  scalarView,
  seed,
} = createClientStateFixture(recordCount);
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};
type Samples = { batchSize: number; elapsedMs: Array<number>; warmupIterations: number };

async function benchmark() {
  const results: Record<string, Samples> = {};
  const measure = async (name: string, run: () => unknown, minimumBatchSize = 1) => {
    // Warm JIT and caches without mixing setup into timed reads/mutations.
    const warmupStart = performance.now();
    let warmupIterations = 0;
    while (warmupIterations < 10 || performance.now() - warmupStart < 100) {
      await run();
      warmupIterations++;
    }
    // WebKit's clock can be rounded to 1 ms. Batch enough work to measure fast
    // paths without reporting zero-duration operations as meaningful results.
    const batchSize = Math.max(
      minimumBatchSize,
      Math.ceil((5 * warmupIterations) / (performance.now() - warmupStart)),
    );
    const elapsedMs: Array<number> = [];
    for (let sample = 0; sample < sampleCount; sample++) {
      await frame();
      const start = performance.now();
      for (let index = 0; index < batchSize; index++) {
        await run();
      }
      elapsedMs.push((performance.now() - start) / batchSize);
    }
    results[name] = { batchSize, elapsedMs, warmupIterations };
  };
  await measure('setup: core client', makeCore, 20);
  await measure('setup: client schema + mutations + empty root', make, 20);
  await measure(
    'setup: 100 types with 20 fields',
    () => createClient().registerClientSchema(largeSchema),
    5,
  );
  await measure('setup: schema + seed graph', () => seed(make()));

  const core = makeCore();
  const client = make();
  seed(core);
  seed(client);
  const ref = client.ref<State>('State', 'main', scalarView);
  const computedRef = client.ref<State>('State', 'main', computedView);
  const graphRef = client.ref<State>('State', 'main', graphView);
  const coreRef = core.ref<State>('State', 'main', scalarView);
  const scalar = () => client.readView(scalarView, ref);
  const computedRead = () => client.readView(computedView, computedRef);
  const graph = () => client.readView(graphView, graphRef);
  assert((await graph()).data.items.length === recordCount, 'Graph seed failed');
  assert(
    (await computedRead()).data.titles === items.map(({ title }) => title).join(', '),
    'Computed read failed',
  );
  await measure('read: core cached scalar', () => core.readView(scalarView, coreRef), 200);
  await measure('read: schema cached scalar', scalar, 200);
  await measure('read: schema cached computed graph', computedRead, 200);
  await measure('read: schema cached graph', graph, 200);

  let version = 0;
  await measure(
    'write: core scalar (lower-level control)',
    () => core.write('State', { count: ++version, id: 'main' }, countPaths),
    20,
  );
  await measure(
    'write: schema scalar (lower-level control)',
    () => client.write('State', { count: ++version, id: 'main' }, countPaths),
    20,
  );
  await measure(
    'mutation: leaf scalar',
    () => client.mutations.leaf({ input: { count: ++version } }),
    10,
  );
  await measure(
    'mutation: parent scalar',
    () => client.mutations.parent({ input: { count: ++version } }),
    5,
  );
  await measure('mutation: parent read-modify-write', () => client.mutations.increment(), 5);
  await measure('mutation: replace relationship', () => client.mutations.replace());
  await measure('mutation: replace changed relationship', () =>
    client.mutations.replaceChanged({ input: { count: ++version } }),
  );
  await measure('mutation: create + delete leaf', async () => {
    await client.mutations.create();
    await client.mutations.remove();
  });
  await measure('mutation + read: changed computed graph', async () => {
    await client.mutations.leaf({ input: { count: ++version } });
    await computedRead();
  });
  await measure('mutation + read: changed graph', async () => {
    await client.mutations.leaf({ input: { count: ++version } });
    await graph();
  });

  let notifications = 0;
  const unsubscribes = Array.from({ length: 100 }, () =>
    client.store.subscribe('Item:0', () => notifications++),
  );
  await measure(
    'mutation: leaf with 100 listeners',
    () => client.mutations.leaf({ input: { count: ++version } }),
    10,
  );
  for (const unsubscribe of unsubscribes) {
    unsubscribe();
  }
  const listenerSamples = results['mutation: leaf with 100 listeners'];
  assert(
    notifications ===
      100 * (listenerSamples.warmupIterations + sampleCount * listenerSamples.batchSize),
    'Unexpected subscription notifications',
  );
  assert(
    (await computedRead()).data.titles.split(', ')[0] === `Edit ${version}`,
    'Stale computed result',
  );
  assert((await graph()).data.items[0].title === `Edit ${version}`, 'Stale graph result');
  return { recordCount, results, sampleCount };
}

try {
  output.textContent = JSON.stringify(await benchmark());
  output.dataset.status = 'done';
} catch (error) {
  output.textContent = error instanceof Error ? (error.stack ?? error.message) : String(error);
  output.dataset.status = 'error';
}
