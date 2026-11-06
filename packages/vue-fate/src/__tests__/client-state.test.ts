/** @vitest-environment happy-dom */
import {
  clientSchema,
  computed,
  createClient,
  dataView,
  field,
  view,
  type EntityOf,
} from '@nkzw/fate';
import { expect, test } from 'vite-plus/test';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { FateClient, useView } from '../index.ts';

test('Vue views subscribe to local computed dependencies across components', async () => {
  const state = dataView<{ count: number; id: string }>('Counter')({
    count: true,
    doubled: computed<{ count: number }, number>({
      resolve: (_item, { count }) => Number(count) * 2,
      select: { count: field('count') },
    }),
    id: true,
  });
  const client = createClient().registerClientSchema(
    clientSchema({
      roots: { counter: { id: 'main', type: 'Counter' } },
      types: { Counter: { defaults: (id) => ({ count: 0, id }), view: state } },
    }),
    ({ mutation }) => ({
      increment: mutation('Counter', {
        resolve: ({ store }) =>
          store.update('Counter', 'main', {
            count: (store.get('Counter', 'main')?.count ?? 0) + 1,
          }),
      }),
    }),
  );
  const Counter = view<EntityOf<typeof client, 'Counter'>>()({ doubled: true });
  const CounterRef = client.ref('Counter', 'main', Counter);
  const Reader = defineComponent({
    setup() {
      const data = useView(Counter, CounterRef);
      return () => h('span', data.value?.doubled);
    },
  });
  const container = document.createElement('div');
  const app = createApp({
    render: () => h(FateClient, { client }, { default: () => [h(Reader), h(Reader)] }),
  });
  app.mount(container);
  try {
    await nextTick();
    expect(container.textContent).toBe('00');
    await client.mutations.increment();
    await nextTick();
    expect(container.textContent).toBe('22');
  } finally {
    app.unmount();
  }
});
