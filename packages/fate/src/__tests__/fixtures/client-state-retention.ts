import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { clientSchema, type EntityOf } from '../../client-schema.ts';
import { createClient } from '../../client.ts';
import { computed, dataView } from '../../server/dataView.ts';
import { view } from '../../view.ts';

const collect = globalThis.gc;
assert.ok(collect, 'Run with --expose-gc');
const scenario = process.argv[2];
const watched: Array<WeakRef<object>> = [];
let settledRead: (() => unknown) | undefined;
const schema = clientSchema({
  types: {
    Payload: {
      defaults: (id) => ({ id, payload: { values: [] } }),
      view: dataView<{ id: string; payload: { values: Array<number> } }>('Payload')({
        first: computed({
          resolve: () => {
            const result = { values: Array.from({ length: 1000 }, (_, i) => i) };
            watched.push(new WeakRef(result));
            return result;
          },
        }),
        id: true,
        payload: true,
        second: computed({
          resolve: () => {
            const result = { values: Array.from({ length: 1000 }, (_, i) => i + 1) };
            watched.push(new WeakRef(result));
            return result;
          },
        }),
      }),
    },
  },
});
const client = createClient({ gcReleaseBufferSize: 0 }).registerClientSchema(
  schema,
  ({ mutation }) => ({
    stage: mutation('Payload', {
      resolve: ({ store }) => {
        const payload = { values: Array.from({ length: 1000 }, (_, i) => i) };
        const result = store.create('Payload', { id: 'p', payload });
        watched.push(new WeakRef(payload), new WeakRef(result.payload!));
        // Retaining a settled mutation context must not retain its staged graph.
        settledRead = () => store.get('Payload', 'p');
        if (scenario === 'rollback') {
          throw new Error('Rollback');
        }
      },
    }),
  }),
);
const populate = async () => {
  if (scenario === 'commit' || scenario === 'rollback') {
    if (scenario === 'rollback') {
      await assert.rejects(client.mutations.stage(), /Rollback/);
    } else {
      await client.mutations.stage();
    }
    assert.throws(() => settledRead!(), /already settled/);
    return;
  }
  assert.ok(scenario === 'single' || scenario === 'multiple');
  client.write('Payload', { id: 'p' }, new Set(['id']));
  const selected = view<EntityOf<typeof client, 'Payload'>>()({
    first: { values: true },
    second: { values: true },
  });
  const single = view<EntityOf<typeof client, 'Payload'>>()({ first: { values: true } });
  if (scenario === 'single') {
    const { data } = await client.readView(single, client.ref('Payload', 'p', single));
    watched.push(new WeakRef(data.first));
  } else {
    const { data } = await client.readView(selected, client.ref('Payload', 'p', selected));
    watched.push(new WeakRef(data.first), new WeakRef(data.second));
  }
};
await populate();
client.gc();
for (let index = 0; index < 3; index++) {
  await setImmediate();
  collect();
}
assert.equal(client.store.read('Payload:p'), undefined);
assert.ok(watched.length);
for (const target of watched) {
  assert.equal(target.deref(), undefined, `${scenario} retained a released client payload`);
}
