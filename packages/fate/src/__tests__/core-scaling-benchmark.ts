import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { createClient } from '../client.ts';
import { clientRoot } from '../root.ts';
import { view } from '../view.ts';
import { createClientStateFixture } from './fixtures/client-state.ts';

const samples = Number(process.argv[2] ?? 25);

async function measure(run: () => unknown) {
  for (let i = 0; i < 10; i++) {
    await run();
  }
  const times: Array<number> = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    await run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return {
    medianMs: times[Math.floor(times.length / 2)],
    p95Ms: times[Math.floor(times.length * 0.95)],
  };
}

function setup(n: number, width: number) {
  const fields = Object.fromEntries(
    Array.from({ length: width }, (_, i) => [`f${i}`, true as const]),
  );
  const selected = view<{
    __typename: 'Parent';
    count: number;
    items: Array<{ __typename: 'Item'; [key: `f${number}`]: number; f0: number }>;
  }>()({
    count: true,
    items: fields as Record<`f${number}`, true> & { f0: true },
  });
  const client = createClient({
    roots: { parent: clientRoot('Parent') },
    types: [
      { fields: { items: { array: true, listOf: 'Item' } }, type: 'Parent' },
      { type: 'Item' },
    ],
  });
  client.write(
    'Parent',
    {
      count: 0,
      id: 'main',
      items: Array.from({ length: n }, (_, i) => ({
        id: String(i),
        ...Object.fromEntries(Object.keys(fields).map((key) => [key, i])),
      })),
    },
    new Set(['count', ...Object.keys(fields).map((key) => `items.${key}`)]),
  );
  return { client, ref: client.ref('Parent', 'main', selected), selected };
}

async function completeness() {
  const results = [];
  for (const rows of [1000, 10_000]) {
    for (const fields of [3, 10]) {
      const { client, ref, selected } = setup(rows, fields);
      await client.readView(selected, ref);
      let version = 0;
      const timing = await measure(async () => {
        client.write('Item', { f0: ++version, id: '0' }, new Set(['f0']));
        const result = await client.readView(selected, ref);
        assert.equal(result.data.items[0].f0, version);
      });
      results.push({ fields, rows, ...timing });
    }
  }
  return results;
}

async function observers() {
  const results = [];
  for (const rows of [1000, 10_000]) {
    for (const mode of ['cache-only', 'result'] as const) {
      const { client, ref, selected } = setup(rows, 3);
      await client.readView(selected, ref);
      const releases = Array.from({ length: 10 }, () => {
        const request = { parent: { id: 'main', view: selected } };
        const observer =
          mode === 'result'
            ? client.observeRequestResult(request)
            : client.observeRequest(request, { mode });
        observer.getSnapshot();
        return observer.subscribe(() => {
          observer.getSnapshot();
        });
      });
      let version = 0;
      const selectedEdit = await measure(async () => {
        client.write('Item', { f0: ++version, id: '0' }, new Set(['f0']));
        await Promise.resolve();
      });
      const unselectedEdit = await measure(async () => {
        client.write('Item', { id: '0', unselected: ++version }, new Set(['unselected']));
        await Promise.resolve();
      });
      releases.forEach((release) => release());
      results.push({ mode, rows, selectedEdit, unselectedEdit });
    }
  }
  return results;
}

async function deletions() {
  const results = [];
  for (const rows of [1000, 3000]) {
    const { make, seed } = createClientStateFixture(rows);
    const times: Array<number> = [];
    for (let sample = 0; sample < 7; sample++) {
      const client = make();
      seed(client);
      const start = performance.now();
      await client.mutations.removeAll();
      const elapsed = performance.now() - start;
      assert.deepEqual(client.store.read('State:main')?.items, []);
      assert.equal(client.store.read(`Item:${rows - 1}`), undefined);
      if (sample >= 2) {
        times.push(elapsed);
      }
    }
    times.sort((a, b) => a - b);
    results.push({ medianMs: times[2], rows, samples: 5 });
  }
  return results;
}

console.log(
  JSON.stringify({
    completeness: await completeness(),
    deletions: await deletions(),
    observers: await observers(),
    samples,
  }),
);
