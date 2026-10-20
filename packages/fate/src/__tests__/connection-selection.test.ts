import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { alias } from '../alias.ts';
import { createClient } from '../client.ts';
import type { ConnectionMetadata, SelectionOf, ViewData, ViewRef } from '../types.ts';
import { ConnectionTag, ViewsTag } from '../types.ts';
import { view } from '../view.ts';
import { when } from '../when.ts';

type MapData = {
  __typename: 'Map';
  id: string;
  secret: string;
  tags: Array<string>;
  title: string;
};
type User = { __typename: 'User'; id: string; maps: Array<MapData> | null };
const Card = view<MapData>()(({ locale }: { locale: string }) => ({
  title: { args: { locale } },
}));
const Selection = {
  args: { first: 1 },
  items: { cursor: true, node: { card: alias(Card({ locale: 'ja' })), id: true, tags: true } },
  pagination: { hasNext: true, nextCursor: true },
} as const;
const Maps = view<User>()({ maps: Selection });

const page = (id: string, title: string, tags: Array<string>, hasNext: boolean) => [
  {
    id: 'owner',
    maps: {
      items: [{ cursor: id, node: { id, tags, title } }],
      pagination: { hasNext, nextCursor: id },
    },
  },
];

test('types inline connection nodes using their selected fields and named bound refs', () => {
  type Data = ViewData<User, SelectionOf<typeof Maps>>;
  type Connection = NonNullable<Data['maps']>;
  type Node = Connection['items'][number]['node'];
  expectTypeOf<Node['tags']>().toEqualTypeOf<Array<string>>();
  expectTypeOf<Node['id']>().toEqualTypeOf<string>();
  expectTypeOf<Node['card']>().toEqualTypeOf<ViewRef<'Map'>>();
  expectTypeOf<Extract<Data['maps'], null>>().toEqualTypeOf<null>();
  expectTypeOf<Extract<keyof Node, 'secret' | 'title'>>().toEqualTypeOf<never>();
  expectTypeOf<Connection['items'][number]['cursor']>().toEqualTypeOf<string>();
  expectTypeOf<Connection['pagination']['hasNext']>().toEqualTypeOf<boolean>();
  expectTypeOf<Extract<keyof Connection['pagination'], 'hasPrevious'>>().toEqualTypeOf<never>();
});

test('distinguishes plain inline node selections from masked node views', () => {
  const Plain = view<User>()({ maps: { items: { node: { tags: true } } } });
  const Masked = view<User>()({ maps: { items: { node: Card({ locale: 'ja' }) } } });
  type PlainItems = NonNullable<ViewData<User, SelectionOf<typeof Plain>>['maps']>['items'];
  type MaskedItems = NonNullable<ViewData<User, SelectionOf<typeof Masked>>['maps']>['items'];
  expectTypeOf<PlainItems[number]['node']['tags']>().toEqualTypeOf<Array<string>>();
  expectTypeOf<Extract<keyof PlainItems[number], 'cursor'>>().toEqualTypeOf<never>();
  expectTypeOf<MaskedItems[number]['node']>().toEqualTypeOf<ViewRef<'Map'>>();
  expectTypeOf<
    Extract<keyof MaskedItems[number]['node'], 'tags' | 'title'>
  >().toEqualTypeOf<never>();
});

test('keeps refs and directly selected fields when inline nodes spread masked views', () => {
  const Composed = view<User>()({
    maps: { items: { node: { ...Card({ locale: 'ja' }), tags: true } } },
  });
  type Node = NonNullable<
    ViewData<User, SelectionOf<typeof Composed>>['maps']
  >['items'][number]['node'];
  expectTypeOf<Node['tags']>().toEqualTypeOf<Array<string>>();
  expectTypeOf<Node[typeof ViewsTag]>().toEqualTypeOf<Set<string>>();
  expectTypeOf<Node>().toExtend<ViewRef<'Map'>>();
  expectTypeOf<Extract<keyof Node, 'title' | 'secret'>>().toEqualTypeOf<never>();
});

test('retains nullable and conditional fields inside an inline node selection', () => {
  type NullableMap = MapData & { description: string | null };
  type Owner = { __typename: 'Owner'; maps: Array<NullableMap> };
  const Conditional = view<Owner>()(({ enabled }: { enabled: boolean }) => ({
    maps: { items: { node: { description: true, tags: when(enabled, true) } } },
  }));
  type Node = ViewData<Owner, SelectionOf<typeof Conditional>>['maps']['items'][number]['node'];
  expectTypeOf<Node['description']>().toEqualTypeOf<string | null>();
  expectTypeOf<Node['tags']>().toEqualTypeOf<Array<string> | undefined>();
});

test('inline node data and bound child refs stay typed and masked after pagination', async () => {
  const fetchById = vi
    .fn()
    .mockResolvedValueOnce(page('1', 'First', ['published'], true))
    .mockResolvedValueOnce(page('2', 'Second', ['draft'], false));
  const client = createClient({
    roots: {},
    transport: { fetchById },
    types: [{ fields: { maps: { listOf: 'Map' } }, type: 'User' }, { type: 'Map' }],
  });
  const ref = client.ref('User', 'owner', Maps);
  const read = async () =>
    (await client.readView<User, SelectionOf<typeof Maps>, typeof Maps>(Maps, ref)).data.maps!;
  const initial = await read();
  expect(initial.items[0].node.tags).toEqual(['published']);
  expect(initial.items[0].node.card).not.toHaveProperty('title');
  expect((await client.readView(Card, initial.items[0].node.card)).data).toMatchObject({
    title: 'First',
  });
  await client.loadConnection(
    Selection.items.node,
    (initial as unknown as { [ConnectionTag]: ConnectionMetadata })[ConnectionTag],
    { after: '1', first: 1 },
  );
  const next = await read();
  expect(next.items.map(({ node }) => node.tags)).toEqual([['published'], ['draft']]);
  expect(next.items.map(({ cursor }) => cursor)).toEqual(['1', '2']);
  expect((await client.readView(Card, next.items[1].node.card)).data).toMatchObject({
    title: 'Second',
  });
  expect(next.pagination.hasNext).toBe(false);
  expect(fetchById).toHaveBeenCalledTimes(2);
});

test('metadata filtering preserves selected schema fields that share configuration names', () => {
  type LiveMap = MapData & { live: boolean };
  type Owner = { __typename: 'Owner'; maps: Array<LiveMap> };
  const Inline = view<Owner>()({ maps: { items: { node: { live: true } } } });
  type Node = ViewData<Owner, SelectionOf<typeof Inline>>['maps']['items'][number]['node'];
  expectTypeOf<Node['live']>().toEqualTypeOf<boolean>();
});
