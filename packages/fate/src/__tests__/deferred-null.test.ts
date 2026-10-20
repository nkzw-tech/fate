import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { defer } from '../defer.ts';
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
      roots: {},
      transport: { fetchById },
      types: [{ fields: { friends: { listOf: 'User' } }, type: 'User' }],
    });
    const plan = getSelectionPlan(Eager, null);
    client.write('User', { friends: null, id: '1' }, plan.paths, plan);
    const parent = (
      await client.readView<User, SelectionOf<typeof Deferred>, typeof Deferred>(
        Deferred,
        client.ref('User', '1', Deferred),
      )
    ).data;
    await expect(client.readDeferred(parent.friends)).resolves.toMatchObject({ data: null });
    await expect(client.readDeferred(parent.friends)).resolves.toMatchObject({ data: null });
    expect(fetchById).not.toHaveBeenCalled();
  },
);
