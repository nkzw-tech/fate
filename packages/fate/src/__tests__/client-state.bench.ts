import { describe } from 'vite-plus/test';
import { clientSchema, type EntityOf } from '../client-schema.ts';
import { createClient } from '../client.ts';
import { computed, dataView, field } from '../server/dataView.ts';
import { view } from '../view.ts';
import bench from './bench.ts';
import { createClientStateFixture, type State } from './fixtures/client-state.ts';

const collectedSchema = clientSchema({
  types: {
    Item: {
      defaults: (id) => ({ id, title: '' }),
      view: dataView<{ id: string; title: string }>('Item')({
        id: true,
        label: computed({
          resolve: (_item, { title }) => String(title),
          select: { title: field('title') },
        }),
        title: true,
      }),
    },
  },
});
const makeCollectedClient = () =>
  createClient({ gcReleaseBufferSize: 0 }).registerClientSchema(collectedSchema);
const collectedView = view<EntityOf<ReturnType<typeof makeCollectedClient>, 'Item'>>()({
  label: true,
});

for (const count of [100, 1000, 5000]) {
  describe(`Client schema with ${count} related records`, async () => {
    const fixture = createClientStateFixture(count);
    const client = fixture.make();
    fixture.seed(client);
    const ref = client.ref<State>('State', 'main', fixture.graphView);
    await client.readView(fixture.graphView, ref);
    let version = 0;
    bench('setup and initialize graph', () => {
      fixture.seed(fixture.make());
    });
    bench('cached graph read', async () => {
      await client.readView(fixture.graphView, ref);
    });
    bench('leaf mutation', async () => {
      await client.mutations.leaf({ input: { count: ++version } });
    });
    bench('parent scalar mutation', async () => {
      await client.mutations.parent({ input: { count: ++version } });
    });
    bench('parent read-modify-write', async () => {
      await client.mutations.increment();
    });
    bench('replace unchanged relationship', async () => {
      await client.mutations.replace();
    });
    bench('replace changed relationship', async () => {
      await client.mutations.replaceChanged({ input: { count: ++version } });
    });
    bench('create and delete leaf', async () => {
      await client.mutations.create();
      await client.mutations.remove();
    });
    bench('initialize computed entities and collect graph', async () => {
      const collected = makeCollectedClient();
      for (const item of fixture.items) {
        collected.write('Item', item, new Set(['id', 'title']));
        await collected.readView(collectedView, collected.ref('Item', item.id, collectedView));
      }
      collected.gc();
    });
  });
}
