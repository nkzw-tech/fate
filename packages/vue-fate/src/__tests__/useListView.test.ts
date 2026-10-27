/** @vitest-environment happy-dom */

import {
  createClient,
  defer,
  view,
  type ConnectionRef,
  type Transport,
  type ViewRef,
  type ViewSelection,
} from '@nkzw/fate';
import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue';
import { FateClient, useListView, useLiveListView, useView } from '../index.ts';

type Comment = { __typename: 'Comment'; content: string; id: string };
const CommentView = view<Comment>()({ content: true, id: true });
const Selection = { items: { node: CommentView } };
const page = (ids: Array<string>, hasNext: boolean) => ({
  items: ids.map((id) => ({ cursor: id, node: { content: id, id } })),
  pagination: { hasNext, hasPrevious: false, nextCursor: ids.at(-1), previousCursor: ids[0] },
});

type Item = ConnectionRef<'Comment'>['items'][number];
const ids = (items: ReadonlyArray<{ node: { id: string | number } }> | undefined) =>
  items?.map(({ node }) => node.id);
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

test('list readers keep independent bounded ranges while sharing cached pages', async () => {
  type Post = { __typename: 'Post'; comments: Array<Comment>; id: string };
  const { client, fetchById } = setup();
  const PostView = view<Post>()(({ first }: { first: number }) => ({
    comments: { args: { first }, items: { node: { content: true, id: true } } },
    id: true,
  }));
  const large = PostView({ first: 4 });
  const small = PostView({ first: 2 });
  fetchById.mockResolvedValueOnce([{ comments: page(['1', '2', '3', '4'], false), id: 'post' }]);
  await client.readView(large, client.ref('Post', 'post', large));
  const result = await client.readView<Post, ViewSelection<typeof small>, typeof small>(
    small,
    client.ref('Post', 'post', small),
  );
  const PreviewView = view<Post>()({
    comments: { args: { first: 2 }, items: { node: { content: true, id: true } } },
    id: true,
  });
  const preview = await client.readView<
    Post,
    ViewSelection<typeof PreviewView>,
    typeof PreviewView
  >(PreviewView, client.ref('Post', 'post', PreviewView));
  const connection = shallowRef(result.data.comments);
  const createResources = () => ({
    feed: useListView(Selection, connection),
    preview: useListView(Selection, preview.data.comments),
  });
  let { app, resource } = mount(client, createResources);
  try {
    await Promise.all([resource.feed.ready(), resource.preview.ready()]);
    expect(ids(resource.feed[0].value)).toEqual(['1', '2']);
    expect(ids(resource.preview[0].value)).toEqual(['1', '2']);
    fetchById.mockResolvedValueOnce([{ comments: page(['3', '4'], false), id: 'post' }]);
    await resource.feed[1].value!();
    expect(ids(resource.feed[0].value)).toEqual(['1', '2', '3', '4']);
    expect(ids(resource.preview[0].value)).toEqual(['1', '2']);
    await resource.feed.refresh();
    expect(ids(resource.feed[0].value)).toEqual(['1', '2', '3', '4']);
    expect(fetchById).toHaveBeenCalledTimes(2);
    app.unmount();
    const remounted = mount(client, createResources);
    app = remounted.app;
    resource = remounted.resource;
    await Promise.all([resource.feed.ready(), resource.preview.ready()]);
    expect(ids(resource.feed[0].value)).toEqual(['1', '2', '3', '4']);
    expect(ids(resource.preview[0].value)).toEqual(['1', '2']);
    expect(fetchById).toHaveBeenCalledTimes(2);
  } finally {
    app.unmount();
  }
});
