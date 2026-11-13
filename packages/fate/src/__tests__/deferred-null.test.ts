import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { defer } from '../defer.ts';
import { getFieldKey } from '../field-key.ts';
import { clientRoot } from '../root.ts';
import { getSelectionPlan } from '../selection.ts';
import type { SelectionOf } from '../types.ts';
import { view } from '../view.ts';

type User = { __typename: 'User'; friends: Array<User> | null; id: string; name: string };
const Name = view<User>()({ id: true, name: true });

test.each([false, true])(
  'a cached nullable deferred list resolves without refetching (arguments: %s)',
  async (withArgs) => {
    const selection = {
      args: withArgs ? { first: 20, status: 'active' } : undefined,
      items: { node: Name },
    };
    const Eager = view<User>()({ friends: selection });
    const Deferred = view<User>()({ friends: defer(selection) });
    const fetchById = vi.fn(async () => {
      throw new Error('Unexpected refetch of a cached null');
    });
    const client = createClient({
      gcReleaseBufferSize: 0,
      roots: { user: clientRoot<User, 'User'>('User') },
      transport: { fetchById },
      types: [{ fields: { friends: { listOf: 'User' } }, type: 'User' }],
    });
    const plan = getSelectionPlan(Eager, null);
    client.write('User', { friends: null, id: '1' }, plan.paths, plan);
    const retained = client.retain({ user: { id: '1', view: Deferred } });
    const parent = (
      await client.readView<User, SelectionOf<typeof Deferred>, typeof Deferred>(
        Deferred,
        client.ref('User', '1', Deferred),
      )
    ).data;
    await expect(client.readDeferred(parent.friends)).resolves.toMatchObject({ data: null });
    client.gc();
    await expect(client.readDeferred(parent.friends)).resolves.toMatchObject({ data: null });
    retained.dispose();
    expect(fetchById).not.toHaveBeenCalled();
  },
);

test('gc never evaluates deferred arguments before the field is opened', async () => {
  const args = vi.fn(() => ({ status: 'active' }));
  const Deferred = view<User>()({
    friends: defer({
      get args() {
        return args();
      },
      items: { node: Name },
    }),
    id: true,
  });
  const Eager = view<User>()({ friends: { args: { status: 'active' }, items: { node: Name } } });
  const fetchById = vi.fn(async () => {
    throw new Error('Unexpected refetch of a cached null');
  });
  const client = createClient({
    gcReleaseBufferSize: 0,
    roots: { user: clientRoot<User, 'User'>('User') },
    transport: { fetchById },
    types: [{ fields: { friends: { listOf: 'User' } }, type: 'User' }],
  });
  const request = { user: { id: '1', view: Deferred } };
  const retained = client.retain(request);
  const plan = getSelectionPlan(Eager, null);
  try {
    client.write('User', { id: '1' }, new Set(['id']));
    const { user } = await client.request(request);
    const { data } = await client.readView(Deferred, user);
    args.mockImplementationOnce(() => {
      throw new Error('Arguments unavailable until opening the field');
    });
    expect(() => client.gc()).not.toThrow();
    expect(args).not.toHaveBeenCalled();
    args.mockReset();

    client.write('User', { friends: null, id: '1' }, plan.paths, plan);
    await expect(client.readDeferred(data.friends)).resolves.toMatchObject({ data: null });
    args.mockImplementation(() => {
      throw new Error('GC must reuse the evaluated arguments');
    });
    args.mockClear();
    expect(() => client.gc()).not.toThrow();
    expect(args).not.toHaveBeenCalled();
    args.mockReset();
    await expect(client.readDeferred(data.friends)).resolves.toMatchObject({ data: null });
    expect(fetchById).not.toHaveBeenCalled();
  } finally {
    retained.dispose();
  }
});

test('gc retains an opened deferred variant across equivalent view bindings', async () => {
  const args = vi.fn((status: string) => ({ status }));
  const Friends = view<User>()(({ status }: { status: string }) => ({
    friends: defer({
      get args() {
        return args(status);
      },
      items: { node: Name },
    }),
    id: true,
  }));
  const Identity = view<User>()({ id: true });
  const Eager = view<User>()(({ status }: { status: string }) => ({
    friends: { args: { status }, items: { node: Name } },
    id: true,
  }));
  const fetchById = vi.fn(async () => {
    throw new Error('Unexpected refetch of a cached null');
  });
  const client = createClient({
    gcReleaseBufferSize: 0,
    roots: { user: clientRoot<User, 'User'>('User') },
    transport: { fetchById },
    types: [{ fields: { friends: { listOf: 'User' } }, type: 'User' }],
  });
  const request = (status: string) => ({ user: { id: '1', view: Friends({ status }) } });
  const active = request('active');
  const render = request('active');
  const inactive = request('inactive');
  expect(client.getRequestKey(active)).toBe(client.getRequestKey(render));
  const keepOwner = client.retain({ user: { id: '1', view: Identity } });
  const keepActive = client.retain(active);
  const keepInactive = client.retain(inactive);
  try {
    for (const status of ['active', 'inactive']) {
      const plan = getSelectionPlan(Eager({ status }), null);
      client.write('User', { friends: null, id: '1' }, plan.paths, plan);
    }
    const activeRef = (await client.request(render)).user;
    const inactiveRef = (await client.request(inactive)).user;
    const { data } = await client.readView(Friends, activeRef);
    const other = await client.readView(Friends, inactiveRef);
    await expect(client.readDeferred(data.friends)).resolves.toMatchObject({ data: null });
    await expect(client.readDeferred(other.data.friends)).resolves.toMatchObject({ data: null });
    const inactiveField = getFieldKey(
      'friends',
      getSelectionPlan(Eager({ status: 'inactive' }), null),
    );
    keepInactive.dispose();
    args.mockClear();
    client.gc();
    expect(args).not.toHaveBeenCalled();
    expect(client.store.read('User:1')).not.toHaveProperty(inactiveField);
    await expect(client.readDeferred(data.friends)).resolves.toMatchObject({ data: null });
    expect(fetchById).not.toHaveBeenCalled();
  } finally {
    keepActive.dispose();
    keepInactive.dispose();
    keepOwner.dispose();
  }
});
