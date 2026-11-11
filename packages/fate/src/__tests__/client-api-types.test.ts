import { expect, expectTypeOf, test } from 'vite-plus/test';
import {
  clientSchema,
  createClient,
  dataView,
  type ClientMutationBuilder,
  type ClientMutationContext,
  type ClientStore,
} from '../index.ts';

const schema = clientSchema({
  roots: { counter: { id: 'main', type: 'Counter' } },
  types: {
    Counter: {
      defaults: (id) => ({ id, value: 0 }),
      view: dataView<{ id: string; value: number }>('Counter')({ id: true, value: true }),
    },
  },
});

type Entities = { Counter: { __typename: 'Counter'; id: string; value: number } };
type Empty = Record<never, never>;
type Store = ClientStore<Entities, typeof schema>;
type Builder = ClientMutationBuilder<Empty, Empty, typeof schema>;
type Context = ClientMutationContext<Entities, Empty, Empty, typeof schema>;

const increment = (store: Store) =>
  store.update('Counter', 'main', { value: (store.get('Counter', 'main')?.value ?? 0) + 1 });

const defineMutations = ({ mutation }: Builder) => ({
  increment: mutation('Counter', { resolve: ({ store }) => increment(store) }),
});

test('public client mutation types support extracted helpers in every framework', async () => {
  expectTypeOf<Context['store']>().toEqualTypeOf<Store>();
  const client = createClient().registerClientSchema(schema, defineMutations);
  const { result } = await client.mutations.increment();
  expectTypeOf(result?.value).toEqualTypeOf<number | undefined>();
  expect(result?.value).toBe(1);
});
