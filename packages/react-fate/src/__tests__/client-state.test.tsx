/** @vitest-environment happy-dom */
import {
  clientSchema,
  computed,
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
import { useRequest } from '../useRequest.tsx';
import { useView } from '../useView.tsx';

// @ts-expect-error React test environment.
global.IS_REACT_ACT_ENVIRONMENT = true;

test('ordinary requests, views and actions share local state across React components', async () => {
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
        </Suspense>
      </FateClient>,
    ),
  );
  expect(container.textContent).toBe('000');
  const renders = identityRenders;
  await act(async () => container.querySelector('button')!.click());
  expect(container.textContent).toBe('112');
  await act(async () => container.querySelector('button')!.click());
  expect(container.textContent).toBe('224');
  expect(identityRenders).toBe(renders);
  await act(async () => root.unmount());
  client.gc();
  expect(client.store.read('Counter:main')?.count).toBe(2);
});
