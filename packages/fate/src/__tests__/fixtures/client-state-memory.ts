import assert from 'node:assert/strict';
import type { HeapProfiler } from 'node:inspector';
import { Session } from 'node:inspector/promises';
import { setImmediate } from 'node:timers/promises';
import { createClientStateFixture, type State } from './client-state.ts';

const collect = globalThis.gc;
assert.ok(collect, 'Run with --expose-gc');
const recordCount = Number(process.argv[2] ?? 1000);
const iterations = Number(process.argv[3] ?? 100);
assert.ok([recordCount, iterations].every((value) => Number.isSafeInteger(value) && value > 0));
const fixture = createClientStateFixture(recordCount);
const session = new Session();
session.connect();
const heap = async () => {
  for (let index = 0; index < 3; index++) {
    await setImmediate();
    collect();
  }
  return process.memoryUsage().heapUsed;
};
const allocated = (node: HeapProfiler.SamplingHeapProfileNode): number =>
  node.selfSize + node.children.reduce((total, child) => total + allocated(child), 0);
const emptyHeapBytes = await heap();
const client = fixture.make();
fixture.seed(client);
const graphRef = client.ref<State>('State', 'main', fixture.graphView);
const computedRef = client.ref<State>('State', 'main', fixture.computedView);
await client.readView(fixture.graphView, graphRef);
await client.readView(fixture.computedView, computedRef);
const populatedHeapBytes = await heap();
let version = 0;
const cases = {
  computed: async () => {
    await client.mutations.leaf({ input: { count: ++version } });
    await client.readView(fixture.computedView, computedRef);
  },
  graph: async () => {
    await client.mutations.leaf({ input: { count: ++version } });
    await client.readView(fixture.graphView, graphRef);
  },
  increment: () => client.mutations.increment(),
  leaf: () => client.mutations.leaf({ input: { count: ++version } }),
  lifecycle: async () => {
    await client.mutations.create();
    await client.mutations.remove();
  },
  parent: () => client.mutations.parent({ input: { count: ++version } }),
  replace: () => client.mutations.replace(),
  replaceChanged: () => client.mutations.replaceChanged({ input: { count: ++version } }),
};
const results: Record<string, { allocatedBytesPerOperation: number; retainedBytes: number }> = {};
try {
  for (const [name, run] of Object.entries(cases)) {
    for (let index = 0; index < 20; index++) {
      await run();
    }
    const before = await heap();
    for (let index = 0; index < iterations; index++) {
      await run();
    }
    const retainedBytes = (await heap()) - before;
    // Include short-lived allocations, not just sampled objects still alive
    // when profiling ends. Sampling and forced GC are outside timing runs.
    const sampling = {
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
      samplingInterval: 16_384,
    };
    await session.post('HeapProfiler.startSampling', sampling);
    for (let index = 0; index < iterations; index++) {
      await run();
    }
    const { profile } = await session.post('HeapProfiler.stopSampling');
    results[name] = {
      allocatedBytesPerOperation: Math.round(allocated(profile.head) / iterations),
      retainedBytes,
    };
  }
  assert.equal(client.store.read('Item:temporary'), undefined);
  assert.equal((await client.readView(fixture.graphView, graphRef)).data.items.length, recordCount);
  console.log(
    JSON.stringify({
      iterations,
      node: process.version,
      populatedHeapBytes: populatedHeapBytes - emptyHeapBytes,
      recordCount,
      results,
    }),
  );
} finally {
  session.disconnect();
}
