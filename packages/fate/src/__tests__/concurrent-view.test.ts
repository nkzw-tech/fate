import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import type { Transport } from '../transport.ts';
import type { ViewSelection } from '../types.ts';
import { view } from '../view.ts';

test('concurrent view readers receive their own selected fields', async () => {
  type User = { __typename: 'User'; age: number; id: string; name: string };
  const Name = view<User>()({ name: true });
  const Profile = view<User>()({ age: true, name: true });
  let resolve!: (records: Array<{ id: string; name: string }>) => void;
  const fetchById = vi.fn(
    () =>
      new Promise<Array<{ id: string; name: string }>>((done) => {
        resolve = done;
      }),
  );
  const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'User' }] });
  client.write('User', { age: 42, id: '1' }, new Set(['id', 'age']));
  const first = client.readView(Name, client.ref('User', '1', Name));
  const second = client.readView(Profile, client.ref('User', '1', Profile));
  resolve([{ id: '1', name: 'Ada' }]);
  await first;
  expect((await second).data).toMatchObject({ age: 42, name: 'Ada' });
  expect(fetchById).toHaveBeenCalledTimes(1);
});

test.each([1, 3])(
  'concurrent view readers get their nested page sizes (first read: %s)',
  async (firstRead) => {
    type Child = { __typename: 'Child'; id: string; name: string };
    type Owner = { __typename: 'Owner'; children: Array<Child>; id: string };
    const OwnerView = view<Owner>()(({ first }: { first: number }) => ({
      children: {
        args: { first },
        items: { node: { id: true, name: true } },
        pagination: { hasNext: true },
      },
    }));
    const pending = Promise.withResolvers<void>();
    const fetchById = vi.fn<Transport['fetchById']>(async (_type, _ids, _select, args) => {
      const first = (args?.children as { first: number } | undefined)?.first ?? 0;
      if (first === firstRead) {
        await pending.promise;
      }
      return [
        {
          children: {
            items: ['1', '2', '3']
              .slice(0, first)
              .map((id) => ({ cursor: id, node: { id, name: id } })),
            pagination: { hasNext: true, hasPrevious: false },
          },
          id: 'owner',
        },
      ];
    });
    const client = createClient({
      roots: {},
      transport: { fetchById },
      types: [{ fields: { children: { listOf: 'Child' } }, type: 'Owner' }, { type: 'Child' }],
    });
    const read = (first: number) => {
      const selection = OwnerView({ first });
      return client.readView<Owner, ViewSelection<typeof selection>, typeof selection>(
        selection,
        client.ref('Owner', 'owner', selection),
      );
    };

    const first = read(firstRead);
    const second = read(firstRead === 1 ? 3 : 1);
    pending.resolve();
    const [small, large] = await Promise.all(firstRead === 1 ? [first, second] : [second, first]);
    expect(small.data.children.items.map(({ node }) => node.id)).toEqual(['1']);
    expect(large.data.children.items.map(({ node }) => node.id)).toEqual(['1', '2', '3']);
    expect(fetchById).toHaveBeenCalledTimes(firstRead === 1 ? 2 : 1);
  },
);
