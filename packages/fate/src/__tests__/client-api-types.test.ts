import { expect, expectTypeOf, test } from 'vite-plus/test';
import {
  clientSchema,
  createClient,
  dataView,
  type ClientMutationBuilder,
  type ClientMutationContext,
  type ClientOf,
  type ClientStore,
  type ClientDefinitionOf,
  type EntityOf,
  clientRoot,
  mutation,
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

type AppClient = ClientOf<typeof schema, ReturnType<typeof defineMutations>>;
const createAppClient = (): AppClient =>
  createClient().registerClientSchema(schema, defineMutations);

test('ClientOf names a factory result without depending on the factory return type', async () => {
  const client = createAppClient();
  expectTypeOf<EntityOf<AppClient, 'Counter'>>().toExtend<Entities['Counter']>();
  const inferred = createClient().registerClientSchema(schema, defineMutations);
  expectTypeOf(client).toEqualTypeOf<typeof inferred>();
  expect((await client.mutations.increment()).result?.value).toBe(1);
});

test('ClientOf preserves base roots, mutations, hydration scope and client extensions', () => {
  type Post = { __typename: 'Post'; id: string; title: string };
  const mutations = { rename: mutation<Post, { title: string }, Post>('Post') };
  const roots = { post: clientRoot<Post, 'Post'>('Post') };
  const base = createClient<[typeof roots, typeof mutations], 'posts-v1'>({
    hydrationScope: 'posts-v1',
    mutations,
    roots,
    types: [{ type: 'Post' }],
  });
  const extension = clientSchema({
    ...schema,
    typeExtensions: {
      Post: {
        defaults: () => ({ bookmarked: false }),
        view: dataView<{ bookmarked: boolean }>('Post')({ bookmarked: true }),
      },
    },
  });
  type Extended = ClientOf<typeof extension, Empty, typeof base>;
  const configured: Extended = base.registerClientSchema(extension);
  expectTypeOf(configured).toEqualTypeOf<Extended>();
  expectTypeOf<ClientDefinitionOf<Extended>['hydrationScope']>().toEqualTypeOf<'posts-v1'>();
  expectTypeOf<ClientDefinitionOf<Extended>['mutations']>().toEqualTypeOf<
    ClientDefinitionOf<typeof base>['mutations'] & Empty
  >();
  expectTypeOf<EntityOf<Extended, 'Post'>['bookmarked']>().toEqualTypeOf<boolean>();
  expectTypeOf<EntityOf<Extended, 'Counter'>>().toExtend<Entities['Counter']>();
  expectTypeOf<ClientDefinitionOf<Extended>['roots']>().toHaveProperty('post');
  expectTypeOf<ClientDefinitionOf<Extended>['roots']>().toHaveProperty('counter');
});
