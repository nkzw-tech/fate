/** @vitest-environment happy-dom */
import {
  clientQuery,
  clientSchema,
  createClient,
  dataView,
  field,
  view,
  type EntityOf,
  type ClientDefinitionOf,
} from '@nkzw/fate';
import { act, startTransition, Suspense, useActionState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vite-plus/test';
import { FateClient } from '../context.tsx';
import { memo } from '../index.tsx';
import { useRequest } from '../useRequest.tsx';
import { useView } from '../useView.tsx';

// @ts-expect-error React test environment.
global.IS_REACT_ACT_ENVIRONMENT = true;

test('ordinary requests, views and actions share local state across React components', async () => {
  const state = dataView<{ count: number; id: string }>('Counter')({
    count: true,
    doubled: memo<{ count: number }, number>({
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
  type Counter = EntityOf<typeof client, 'Counter'>;
  const Count = view<Counter>()({ count: true });
  const Double = view<Counter>()({ doubled: true });
  const Identity = view<Counter>()({ id: true });
  const request = { counter: { view: Count } };
  await client.request(request);
  let identityRenders = 0;
  const IdentityReader = () => {
    useView(Identity, client.ref('Counter', 'main', Identity));
    identityRenders++;
    return null;
  };
  const Reader = () => {
    const { counter } = useRequest<typeof request, ClientDefinitionOf<typeof client>['roots']>(
      request,
    );
    const data = useView(Count, counter);
    const [, increment] = useActionState(client.actions.increment, null);
    return (
      <button
        onClick={() => {
          startTransition(() => increment(data.count ? { view: Count } : {}));
        }}
        type="button"
      >
        {data.count}
      </button>
    );
  };
  const Derived = () => (
    <span>{useView(Double, client.ref('Counter', 'main', Double)).doubled}</span>
  );
  const otherClient = createClient();
  const ExplicitCounter = () => (
    <span>{useView(Count, client.ref('Counter', 'main', Count), { client }).count}</span>
  );
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <FateClient client={client}>
        <Suspense>
          <Reader />
          <Reader />
          <Derived />
          <IdentityReader />
          <FateClient client={otherClient}>
            <ExplicitCounter />
          </FateClient>
        </Suspense>
      </FateClient>,
    ),
  );
  expect(container.textContent).toBe('0000');
  const renders = identityRenders;
  await act(async () => container.querySelector('button')!.click());
  expect(container.textContent).toBe('1121');
  await act(async () => container.querySelector('button')!.click());
  expect(container.textContent).toBe('2242');
  expect(identityRenders).toBe(renders);
  await act(async () => root.unmount());
  client.gc();
  expect(client.store.read('Counter:main')?.count).toBe(2);
});

test('a nullable client query updates an existing component when its record is created or deleted', async () => {
  const client = createClient().registerClientSchema(
    clientSchema({
      roots: { counter: clientQuery('Counter', { resolve: () => 'main' }) },
      types: {
        Counter: {
          defaults: (id) => ({ count: 0, id }),
          view: dataView<{ count: number; id: string }>('Counter')({ count: true, id: true }),
        },
      },
    }),
    ({ mutation }) => ({
      create: mutation('Counter', {
        resolve: ({ store }) => store.create('Counter', { count: 2, id: 'main' }),
      }),
      remove: mutation('Counter', { resolve: ({ store }) => store.delete('Counter', 'main') }),
    }),
  );
  const Counter = view<EntityOf<typeof client, 'Counter'>>()({ count: true });
  const request = { counter: { view: Counter } };
  const Reader = () => {
    const { counter } = useRequest<typeof request, ClientDefinitionOf<typeof client>['roots']>(
      request,
    );
    return <span>{useView(Counter, counter)?.count ?? 'missing'}</span>;
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <FateClient client={client}>
          <Suspense>
            <Reader />
          </Suspense>
        </FateClient>,
      ),
    );
    expect(container.textContent).toBe('missing');
    await act(async () => void (await client.mutations.create()));
    expect(container.textContent).toBe('2');
    await act(async () => void (await client.mutations.remove()));
    expect(container.textContent).toBe('missing');
  } finally {
    await act(async () => root.unmount());
  }
  await client.mutations.create();
  client.gc();
  expect((await client.request(request)).counter?.id).toBe('main');
});
