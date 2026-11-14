import console from 'node:console';
import process from 'node:process';
import { createClient } from '../client.ts';
import { clientRoot } from '../root.ts';
import { view } from '../view.ts';
import { createClientStateFixture } from './fixtures/client-state.ts';

const summarize = (values: Array<number>) => {
  values.sort((a, b) => a - b);
  return {
    p50: values[Math.floor(values.length / 2)],
    p95: values[Math.floor(values.length * 0.95)],
  };
};
async function measure(run: () => unknown, count = Number(process.argv[2] ?? 15)) {
  for (let i = 0; i < 5; i++) {
    await run();
  }
  const values = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    await run();
    values.push(performance.now() - start);
  }
  return summarize(values);
}

async function graph() {
  const results = [];
  for (const n of [100, 1000, 10_000]) {
    const { computedView, graphView, make, seed } = createClientStateFixture(n);
    const client = make();
    seed(client);
    const ref = client.ref('State', 'main', graphView);
    const computedRef = client.ref('State', 'main', computedView);
    const read = () => client.readView(graphView, ref);
    const computedRead = () => client.readView(computedView, computedRef);
    await read();
    await computedRead();
    let version = 0;
    const leaf = () =>
      client.write('Item', { id: '0', title: `Edit ${++version}` }, new Set(['id', 'title']));
    const resultsForSize: any = { leafWrite: await measure(leaf), n };
    resultsForSize.leafWriteAndGraphRead = await measure(() => {
      leaf();
      return read();
    });
    resultsForSize.leafWriteAndComputedRead = await measure(() => {
      leaf();
      return computedRead();
    });
    // A parent count change does not change the computed dependency titles.
    const mixed = view<any>()({ count: true, titles: true });
    const mixedRef = client.ref('State', 'main', mixed);
    await client.readView(mixed, mixedRef);
    resultsForSize.parentCountAndUnchangedComputedRead = await measure(() => {
      client.write('State', { count: ++version, id: 'main' }, new Set(['id', 'count']));
      return client.readView(mixed, mixedRef);
    });
    let reads = 0;
    const original = client.store.read;
    client.store.read = function (...args) {
      reads++;
      return original.apply(this, args);
    };
    leaf();
    reads = 0;
    const snapshot = await read();
    if (snapshot.data.items[0].title !== `Edit ${version}`) {
      throw Error('Incorrect graph');
    }
    resultsForSize.storeReadsPerGraphRead = reads;
    client.write('State', { count: ++version, id: 'main' }, new Set(['id', 'count']));
    reads = 0;
    await client.readView(mixed, mixedRef);
    resultsForSize.storeReadsPerUnchangedComputedRead = reads;
    client.store.read = original;
    results.push(resultsForSize);
  }
  return results;
}

async function optimistic() {
  const results = [];
  const selection = view<any>()({ id: true, title: true });
  for (const n of [100, 1000]) {
    for (const pending of [0, 10, 50]) {
      let version = 0,
        applications = 0;
      const records = Array.from({ length: n }, (_, id) => ({ id: String(id), title: 'initial' }));
      const client = createClient({
        roots: { items: clientRoot('Item') },
        transport: { fetchById: async () => records },
        types: [{ type: 'Item' }, { type: 'Pending' }],
      });
      const settles = [];
      for (let i = 0; i < pending; i++) {
        client.write('Pending', { id: String(i), title: 'confirmed' }, new Set(['id', 'title']));
        settles.push(
          client.store.optimisticUpdate(() => {
            applications++;
            client.write(
              'Pending',
              { id: String(i), title: 'optimistic' },
              new Set(['id', 'title']),
            );
          }),
        );
      }
      const run = async () => {
        for (const row of records) {
          row.title = `Version ${++version}`;
        }
        applications = 0;
        await client.request(
          { items: { ids: records.map((r) => r.id), view: selection } },
          { mode: 'network-only' },
        );
      };
      const time = await measure(run);
      for (const row of records) {
        if (client.store.read(`Item:${row.id}`)?.title !== row.title) {
          throw Error('Incorrect fetched record');
        }
      }
      for (let i = 0; i < pending; i++) {
        if (client.store.read(`Pending:${i}`)?.title !== 'optimistic') {
          throw Error('Lost optimistic layer');
        }
      }
      results.push({ n, pending, ...time, applications });
      settles.forEach((settle) => settle());
    }
  }
  return results;
}

console.log(
  JSON.stringify(
    { graph: await graph(), node: process.version, optimistic: await optimistic() },
    null,
    2,
  ),
);
