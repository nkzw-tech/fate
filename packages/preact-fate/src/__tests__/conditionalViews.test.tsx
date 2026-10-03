/** @vitest-environment happy-dom */
import { createClient, clientRoot, type ViewRef } from '@nkzw/fate';
import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { alias, FateClient, useLiveView, useRequest, useView, view, when } from '../index.ts';
import { act, Suspense } from './preact.ts';
import { createRoot } from './preact.ts';

type User = { __typename: 'User'; id: string; name: string };
const Name = view<User>()(({ locale }: { locale: string }) => ({ name: { args: { locale } } }));
const Parent = view<User>()(({ enabled }: { enabled: boolean }) => ({
  details: when(enabled, alias(Name({ locale: 'ja' }))),
}));
const setup = () => {
  const unsubscribe = vi.fn();
  const subscribeById = vi.fn(() => unsubscribe);
  const fetchById = vi.fn(async (_type, ids, _select, args) =>
    ids.map((id: string | number) => ({
      __typename: 'User',
      id,
      name: args?.name?.locale ?? 'Ada',
    })),
  );
  const roots = { user: clientRoot<User, 'User'>('User') };
  const client = createClient<[typeof roots, Record<never, never>]>({
    roots,
    transport: { fetchById, subscribeById },
    types: [{ type: 'User' }],
  });
  return { client, fetchById, roots, subscribeById, unsubscribe };
};

test('conditionally reads named bound views without hook-order changes or redundant requests', async () => {
  const { client, fetchById, roots } = setup();
  const element = document.createElement('div');
  const root = createRoot(element);
  function Component({ enabled }: { enabled: boolean }) {
    const request = { user: { id: '1', view: Parent({ enabled }) } };
    const { user } = useRequest<typeof request, typeof roots>(request);
    const parent = useView(Parent, user);
    const child = useView(Name, parent.details);
    expectTypeOf(child).toExtend<{ name: string } | undefined>();
    return <span>{child === undefined ? 'off' : child.name}</span>;
  }
  const render = (enabled: boolean) =>
    act(async () =>
      root.render(
        <FateClient client={client}>
          <Suspense fallback="pending">
            <Component enabled={enabled} />
          </Suspense>
        </FateClient>,
      ),
    );
  await render(false);
  expect(element.textContent).toBe('off');
  expect(fetchById).not.toHaveBeenCalled();
  await render(true);
  expect(element.textContent).toBe('ja');
  await render(true);
  expect(fetchById).toHaveBeenCalledTimes(1);
  await render(false);
  expect(element.textContent).toBe('off');
  await render(true);
  expect(element.textContent).toBe('ja');
  expect(fetchById).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});

test('undefined and null refs preserve their types and never fetch or subscribe', async () => {
  const { client, fetchById, subscribeById } = setup();
  const subscribe = vi.spyOn(client.store, 'subscribe');
  const element = document.createElement('div');
  const root = createRoot(element);
  const Hidden = view<User>()({ name: when(false, true) });
  function Component() {
    const hidden = useLiveView(Hidden, client.ref('User', '1', Hidden));
    expect(hidden.name).toBeUndefined();
    const absent = useView(Name, undefined);
    const empty = useView(Name, null);
    const live = useLiveView(Name, undefined);
    expectTypeOf(absent).toEqualTypeOf<undefined>();
    expectTypeOf(empty).toEqualTypeOf<null>();
    expectTypeOf(live).toEqualTypeOf<undefined>();
    return (
      <span>
        {String(absent)}:{String(empty)}:{String(live)}
      </span>
    );
  }
  await act(async () =>
    root.render(
      <FateClient client={client}>
        <Component />
      </FateClient>,
    ),
  );
  expect(element.textContent).toBe('undefined:null:undefined');
  expect(fetchById).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
  expect(subscribeById).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

test('live views switch bindings on the same entity and release inactive subscriptions', async () => {
  const { client, subscribeById, unsubscribe } = setup();
  const first = client.ref('User', '1', Name({ locale: 'en' }));
  const second = client.ref('User', '1', Name({ locale: 'ja' }));
  await client.readView(Name, first);
  await client.readView(Name, second);
  const element = document.createElement('div');
  const root = createRoot(element);
  function Component({ value }: { value: ViewRef<'User'> | undefined }) {
    return <span>{useLiveView(Name, value)?.name ?? 'off'}</span>;
  }
  const render = (value: ViewRef<'User'> | undefined) =>
    act(async () =>
      root.render(
        <FateClient client={client}>
          <Component value={value} />
        </FateClient>,
      ),
    );
  await render(first);
  expect(element.textContent).toBe('en');
  await render(second);
  expect(element.textContent).toBe('ja');
  expect(subscribeById).toHaveBeenCalledTimes(2);
  await render(undefined);
  expect(element.textContent).toBe('off');
  expect(unsubscribe).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
});

test('deferred parameterized refs retain their binding and snapshot identity', async () => {
  const { defer } = await import('../index.ts');
  type ParentUser = User & { friend: User };
  const DeferredParent = view<ParentUser>()({ friend: defer(Name({ locale: 'ja' })) });
  const client = createClient({
    roots: {},
    transport: { fetchById: vi.fn(async () => []) },
    types: [{ fields: { friend: { type: 'User' } }, type: 'User' }],
  });
  client.write(
    'User',
    { friend: { __typename: 'User', id: '2' }, id: '1' },
    new Set(['friend.id']),
  );
  const { getSelectionPlan } = await import('@nkzw/fate');
  const bound = Name({ locale: 'ja' });
  client.write(
    'User',
    { id: '2', name: 'Japanese' },
    new Set(['name']),
    getSelectionPlan(bound, null),
  );
  const parentRef = client.ref('User', '1', DeferredParent);
  const element = document.createElement('div');
  const root = createRoot(element);
  let renders = 0;
  function Component() {
    if (++renders > 20) {
      throw new Error('Unstable deferred snapshot');
    }
    const parent = useView(DeferredParent, parentRef);
    const child = useView(Name, parent.friend);
    return <span>{child.name}</span>;
  }
  try {
    // React 19 lets the root suspend without a boundary; Preact needs one.
    await act(async () =>
      root.render(
        <FateClient client={client}>
          <Suspense fallback={null}>
            <Component />
          </Suspense>
        </FateClient>,
      ),
    );
    expect(renders).toBeLessThan(20);
    expect(element.textContent).toBe('Japanese');
  } finally {
    await act(async () => root.unmount());
  }
});
