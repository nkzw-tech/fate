/** @vitest-environment happy-dom */

import {
  createClient,
  defer,
  view,
  type ConnectionRef,
  type Transport,
  type ViewRef,
} from '@nkzw/fate';
import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue';
import { FateClient, useListView, useLiveListView, useView } from '../index.ts';

type Comment = { __typename: 'Comment'; content: string; id: string };
const CommentView = view<Comment>()({ content: true, id: true });
const Selection = { items: { node: CommentView } };
type Item = ConnectionRef<'Comment'>['items'][number];
const setup = () => {
  const fetchById = vi.fn<Transport['fetchById']>(async () => []);
  const client = createClient({
    roots: {},
    transport: { fetchById },
    types: [{ fields: { comments: { listOf: 'Comment' } }, type: 'Post' }, { type: 'Comment' }],
  });
  return { client, fetchById };
};
const mount = <T>(client: ReturnType<typeof setup>['client'], setupResource: () => T) => {
  let resource!: T;
  const Component = defineComponent({
    setup() {
      resource = setupResource();
      return () => h('span');
    },
  });
  const app = createApp({
    render: () => h(FateClient, { client }, { default: () => h(Component) }),
  });
  app.mount(document.createElement('div'));
  return { app, resource };
};

test('preserves absent connections and distinguishes them from empty lists in values and types', async () => {
  const { client, fetchById } = setup();
  const loaded: ConnectionRef<'Comment'> = {
    items: [{ node: client.ref('Comment', '1', CommentView) }],
  };
  const connection = shallowRef<ConnectionRef<'Comment'> | null | undefined>(undefined);
  const { app, resource } = mount(client, () => {
    const present = useListView(Selection, loaded);
    const absent = useListView(Selection, undefined);
    const empty = useListView(Selection, null);
    const optional = useListView(Selection, connection);
    const live = useLiveListView(Selection, connection);
    expectTypeOf(present[0].value).toEqualTypeOf<ReadonlyArray<Item>>();
    expectTypeOf(absent[0].value).toEqualTypeOf<undefined>();
    expectTypeOf(empty[0].value).toEqualTypeOf<undefined>();
    expectTypeOf(optional[0].value).toEqualTypeOf<ReadonlyArray<Item> | undefined>();
    expectTypeOf(live[0].value).toEqualTypeOf<ReadonlyArray<Item> | undefined>();
    const checkTypes = () => {
      // @ts-expect-error Optional connections require an absence check.
      optional[0].value.map(({ node }) => node.id);
    };
    expect(checkTypes).toBeTypeOf('function');
    return { absent, empty, live, optional, present };
  });
  try {
    expect(await resource.present.ready()).toEqual(loaded.items);
    expect(await resource.absent.ready()).toBeUndefined();
    expect(await resource.empty.ready()).toBeUndefined();
    expect(await resource.optional.ready()).toBeUndefined();
    connection.value = loaded;
    await nextTick();
    await Promise.all([resource.optional.ready(), resource.live.ready()]);
    expect(resource.optional[0].value).toEqual(loaded.items);
    expect(resource.live[0].value).toEqual(loaded.items);
    connection.value = { items: [] };
    await nextTick();
    expect(await resource.optional.ready()).toEqual([]);
    expect(await resource.live.ready()).toEqual([]);
    connection.value = null;
    await nextTick();
    expect(await resource.optional.ready()).toBeUndefined();
    expect(await resource.live.ready()).toBeUndefined();
    expect(resource.optional[1].value).toBeNull();
    expect(resource.optional[2].value).toBeNull();
    expect(fetchById).not.toHaveBeenCalled();
  } finally {
    app.unmount();
  }
});

test('preserves optional or missing items as potentially absent', async () => {
  const { client } = setup();
  const { app, resource } = mount(client, () => {
    const optional: { items?: ReadonlyArray<Item> } = {};
    const missing = { pagination: { hasNext: false, hasPrevious: false } };
    const items = useListView(Selection, optional);
    const withoutItems = useListView(Selection, missing);
    expectTypeOf(items[0].value).toEqualTypeOf<ReadonlyArray<Item> | undefined>();
    expectTypeOf(withoutItems[0].value).toEqualTypeOf<undefined>();
    return { items, withoutItems };
  });
  try {
    expect(await resource.items.ready()).toBeUndefined();
    expect(await resource.withoutItems.ready()).toBeUndefined();
  } finally {
    app.unmount();
  }
});

test('accepts nullable deferred connections in list and live-list resources', async () => {
  type Post = { __typename: 'Post'; comments: Array<Comment> | null; id: string };
  const PostView = view<Post>()({ comments: defer(Selection), id: true });
  const { client, fetchById } = setup();
  client.write('Post', { id: 'post' }, new Set(['id']));
  fetchById.mockResolvedValue([{ comments: null, id: 'post' }]);
  const { app, resource } = mount(client, () => {
    const post = useView(PostView, client.ref('Post', 'post', PostView));
    const connection = () => post.value?.comments;
    const items = useListView(Selection, connection);
    const live = useLiveListView(Selection, connection);
    expectTypeOf<Extract<(typeof items)[0]['value'], undefined>>().toEqualTypeOf<undefined>();
    expectTypeOf<Extract<(typeof live)[0]['value'], undefined>>().toEqualTypeOf<undefined>();
    expectTypeOf<NonNullable<(typeof items)[0]['value']>[number]['node']>().toEqualTypeOf<
      ViewRef<'Comment'>
    >();
    return { items, live, post };
  });
  try {
    await resource.post.ready();
    await nextTick();
    expect(await resource.items.ready()).toBeUndefined();
    expect(await resource.live.ready()).toBeUndefined();
    expect(resource.live.error.value).toBeNull();
    expect(fetchById).toHaveBeenCalledTimes(1);
  } finally {
    app.unmount();
  }
});
