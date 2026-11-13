import { z } from 'zod';
import { clientSchema } from '../../client-schema.ts';
import { createClient } from '../../client.ts';
import { computed, dataView, field, list } from '../../server/dataView.ts';
import { view } from '../../view.ts';

export type Item = { __typename: 'Item'; done: boolean; id: string; title: string };
export type State = {
  __typename: 'State';
  count: number;
  id: string;
  items: Array<Item>;
  titles: string;
};
const makeCore = () =>
  createClient({
    types: [
      { fields: { done: 'scalar', id: 'scalar', title: 'scalar' }, type: 'Item' },
      {
        fields: { count: 'scalar', id: 'scalar', items: { array: true, listOf: 'Item' } },
        type: 'State',
      },
    ],
  });
export function createClientStateFixture(recordCount: number) {
  const items = Array.from({ length: recordCount }, (_, index) => ({
    __typename: 'Item' as const,
    done: false,
    id: String(index),
    title: `Task ${index}`,
  }));
  const item = dataView<Item>('Item')({ done: true, id: true, title: true });
  const changedItems = items.map((item) => ({ ...item, done: true }));
  const state = dataView<State>('State')({
    count: true,
    id: true,
    items: list(item),
    titles: computed({
      resolve: (_item: State, { titles = [] }) => titles.join(', '),
      select: { titles: field('items.title') },
    }),
  });
  const schema = clientSchema({
    roots: { state: { id: 'main', type: 'State' } },
    types: {
      Item: { defaults: (id) => ({ done: false, id, title: '' }), view: item },
      State: { defaults: (id) => ({ count: 0, id, items: [] }), view: state },
    },
  });
  const scalarView = view<State>()({ count: true, id: true });
  const computedView = view<State>()({ titles: true });
  const graphView = view<State>()({ count: true, items: { done: true, id: true, title: true } });
  const paths = new Set(['id', 'count', 'items', 'items.id', 'items.title', 'items.done']);
  const countPaths = new Set(['id', 'count']);
  const input = z.object({ count: z.number() });
  const largeSchema = clientSchema({
    types: Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        `Type${index}`,
        {
          defaults: (id: string | number) => ({ id }),
          view: dataView<Record<string, unknown>>(`Type${index}`)(
            Object.fromEntries(
              Array.from({ length: 20 }, (_, field) => [`field${field}`, true as const]),
            ),
          ),
        },
      ]),
    ),
  });
  const make = () =>
    createClient().registerClientSchema(schema, ({ mutation }) => ({
      create: mutation('Item', {
        resolve: ({ store }) => store.create('Item', { id: 'temporary', title: 'Temporary' }),
      }),
      increment: mutation('State', {
        resolve: ({ store }) =>
          store.update('State', 'main', { count: store.get('State', 'main')!.count! + 1 }),
      }),
      incrementPatch: mutation('State', {
        resolve: ({ store }) => {
          // Old runtimes ignore the projection argument; both read the same count.
          const count = store.get('State', 'main', ['count'])!.count! + 1;
          if (typeof store.patch === 'function') {
            store.patch('State', 'main', { count });
          } else {
            store.update('State', 'main', { count });
          }
        },
      }),
      leaf: mutation('Item', {
        input,
        resolve: ({ input, store }) => store.update('Item', '0', { title: `Edit ${input.count}` }),
      }),
      parent: mutation('State', {
        input,
        resolve: ({ input, store }) => store.update('State', 'main', { count: input.count }),
      }),
      parentPatch: mutation('State', {
        input,
        resolve: ({ input, store }) => {
          // Older runtimes provide the same write but construct an ignored snapshot.
          if (typeof store.patch === 'function') {
            store.patch('State', 'main', { count: input.count });
          } else {
            store.update('State', 'main', { count: input.count });
          }
        },
      }),
      remove: mutation('Item', {
        resolve: ({ store }) => store.delete('Item', 'temporary'),
      }),
      replace: mutation('State', {
        resolve: ({ store }) => store.update('State', 'main', { items }),
      }),
      replaceChanged: mutation('State', {
        input,
        resolve: ({ input, store }) =>
          store.update('State', 'main', { items: input.count % 2 ? changedItems : items }),
      }),
    }));
  const seed = (client: Pick<ReturnType<typeof createClient>, 'write'>) =>
    client.write('State', { count: 0, id: 'main', items }, paths);
  return {
    computedView,
    countPaths,
    graphView,
    items,
    largeSchema,
    make,
    makeCore,
    scalarView,
    schema,
    seed,
  };
}
