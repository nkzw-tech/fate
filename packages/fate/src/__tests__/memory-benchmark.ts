import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { setImmediate } from 'node:timers/promises';
import { createClient } from '../client.ts';
import { clientRoot } from '../root.ts';
import { view } from '../view.ts';
import { createClientStateFixture } from './fixtures/client-state.ts';

async function memory() {
  // WeakRef targets stay alive until the end of the current job. Cross a task
  // boundary before each GC, and never dereference targets before measuring.
  // The loops also yield after each operation so probes do not keep every
  // intermediate snapshot in a whole batch alive through WeakRef job semantics.
  for (let i = 0; i < 3; i++) {
    await setImmediate();
    globalThis.gc!();
  }
  return process.memoryUsage();
}

async function graph(n: number, computed: boolean, burst = false) {
  const fixture = createClientStateFixture(n);
  const client = fixture.make();
  fixture.seed(client);
  const selected = computed ? fixture.computedView : fixture.graphView;
  const ref = client.ref('State', 'main', selected);
  let version = 0;
  const obsolete: Array<WeakRef<object>> = [];
  const run = async () => {
    client.write(
      'Item',
      { id: String(version++ % n), title: `Edit ${version}` },
      new Set(['title']),
    );
    const snapshot = await client.readView(selected, ref);
    obsolete.push(new WeakRef(snapshot));
  };
  const seeded = await memory();
  for (let i = 0; i < 100; i++) {
    await run();
    if (!burst) {
      await setImmediate();
    }
  }
  const checkpoints = [await memory()];
  for (let batch = 0; batch < 5; batch++) {
    for (let i = 0; i < 200; i++) {
      await run();
      if (!burst) {
        await setImmediate();
      }
    }
    checkpoints.push(await memory());
  }
  const liveSnapshots = obsolete.filter((value) => value.deref()).length;
  assert.ok(liveSnapshots <= 2, `Retained ${liveSnapshots} obsolete snapshots`);
  return { burst, checkpoints, computed, liveSnapshots, n, operations: version, seeded };
}

async function nested() {
  const n = 1000;
  const selected = view<{
    __typename: 'Parent';
    count: number;
    id: string;
    items: Array<{
      __typename: 'Item';
      friend: { __typename: 'Friend'; id: string; name: string };
      id: string;
      name: string;
    }>;
  }>()({ count: true, items: { friend: { name: true }, name: true } });
  const client = createClient({
    types: [
      { fields: { items: { array: true, listOf: 'Item' } }, type: 'Parent' },
      { fields: { friend: { type: 'Friend' } }, type: 'Item' },
      { type: 'Friend' },
    ],
  });
  client.write(
    'Parent',
    {
      count: 0,
      id: 'main',
      items: Array.from({ length: n }, (_, i) => ({
        friend: { id: String(i), name: 'Friend' },
        id: String(i),
        name: 'Item',
      })),
    },
    new Set(['count', 'items.name', 'items.friend.name']),
  );
  const ref = client.ref('Parent', 'main', selected);
  let version = 0;
  const obsolete: Array<WeakRef<object>> = [];
  const run = async () => {
    // Touch every row across batches, forcing old subtree results to be replaced.
    const id = String(version++ % n);
    client.write('Friend', { id, name: `Friend ${version}` }, new Set(['name']));
    const snapshot = await client.readView(selected, ref);
    obsolete.push(new WeakRef(snapshot.data.items[Number(id)]));
    assert.equal(snapshot.data.items[Number(id)].friend.name, `Friend ${version}`);
  };
  const seeded = await memory();
  for (let i = 0; i < n; i++) {
    await run();
    await setImmediate();
  }
  const checkpoints = [await memory()];
  for (let batch = 0; batch < 5; batch++) {
    for (let i = 0; i < n; i++) {
      await run();
      await setImmediate();
    }
    checkpoints.push(await memory());
  }
  const liveSubtrees = obsolete.filter((value) => value.deref()).length;
  assert.equal(liveSubtrees, n);
  return { checkpoints, liveSubtrees, n, operations: version, seeded };
}

async function optimistic() {
  const selected = view<any>()({ title: true });
  const records = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), title: 'Initial' }));
  const client = createClient({
    roots: { items: clientRoot('Item') },
    transport: { fetchById: async () => records },
    types: [{ type: 'Item' }],
  });
  const request = { items: { ids: records.map((row) => row.id), view: selected } };
  await client.request(request);
  let version = 0;
  const run = async () => {
    const settles = Array.from({ length: 10 }, (_, i) =>
      client.store.optimisticUpdate(() =>
        client.write('Item', { id: String(i), title: 'Pending' }, new Set(['title'])),
      ),
    );
    for (const row of records) {
      row.title = `Version ${++version}`;
    }
    await client.request(request, { mode: 'network-only' });
    settles.forEach((settle) => settle());
    assert.equal(client.store.read('Item:0')?.title, records[0].title);
  };
  for (let i = 0; i < 20; i++) {
    await run();
    await setImmediate();
  }
  const checkpoints = [await memory()];
  for (let batch = 0; batch < 5; batch++) {
    for (let i = 0; i < 50; i++) {
      await run();
      await setImmediate();
    }
    checkpoints.push(await memory());
  }
  return { checkpoints, operations: 270 };
}

async function lifetimes() {
  const clients: Array<WeakRef<object>> = [];
  const run = async () => {
    const fixture = createClientStateFixture(1000);
    const client = fixture.make();
    fixture.seed(client);
    await client.readView(fixture.graphView, client.ref('State', 'main', fixture.graphView));
    await client.readView(fixture.computedView, client.ref('State', 'main', fixture.computedView));
    clients.push(new WeakRef(client));
  };
  for (let i = 0; i < 20; i++) {
    await run();
    await setImmediate();
  }
  const checkpoints = [await memory()];
  for (let batch = 0; batch < 5; batch++) {
    for (let i = 0; i < 20; i++) {
      await run();
      await setImmediate();
    }
    checkpoints.push(await memory());
  }
  const liveClients = clients.filter((value) => value.deref()).length;
  assert.equal(liveClients, 0);
  return { checkpoints, liveClients, operations: clients.length };
}
const initial = await memory();
const graphResult = await graph(10_000, false);
const computedResult = await graph(10_000, true);
const nestedResult = await nested();
const optimisticResult = await optimistic();
const lifetimeResult = await lifetimes();
const beforeBurst = await memory();
const burstResult = await graph(10_000, true, true);
const released = await memory();
// A generous ceiling catches retained global bookkeeping, independent of graph size.
assert.ok(
  released.heapUsed - initial.heapUsed < 16 * 1024 * 1024,
  'Retained more than 16 MiB after releasing every client',
);
console.log(
  JSON.stringify({
    beforeBurst,
    computed: computedResult,
    computedBurst: burstResult,
    graph: graphResult,
    initial,
    lifetimes: lifetimeResult,
    nested: nestedResult,
    optimistic: optimisticResult,
    released,
  }),
);
