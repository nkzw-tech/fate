/** @vitest-environment happy-dom */

import {
  createClient,
  defer,
  view,
  type ConnectionRef,
  type Transport,
  type ViewRef,
} from '@nkzw/fate';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { FateClient } from '../context.tsx';
import { useListView } from '../useListView.tsx';
import { useLiveListView } from '../useLiveListView.tsx';
import { useView } from '../useView.tsx';

// @ts-expect-error React test environment.
global.IS_REACT_ACT_ENVIRONMENT = true;

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

test('nullable list inputs retain absence in their result types and runtime values', async () => {
  const { client, fetchById } = setup();
  const loaded: ConnectionRef<'Comment'> = {
    items: [{ node: client.ref('Comment', '1', CommentView) }],
  };
  const Component = ({
    connection,
  }: {
    connection: ConnectionRef<'Comment'> | null | undefined;
  }) => {
    const [present] = useListView(Selection, loaded);
    const [absent] = useListView(Selection, undefined);
    const [empty] = useListView(Selection, null);
    const [optional, next, previous] = useListView(Selection, connection);
    const [live] = useLiveListView(Selection, connection);
    expectTypeOf(present).toEqualTypeOf<ReadonlyArray<Item>>();
    expectTypeOf(absent).toEqualTypeOf<undefined>();
    expectTypeOf(empty).toEqualTypeOf<undefined>();
    expectTypeOf(optional).toEqualTypeOf<ReadonlyArray<Item> | undefined>();
    expectTypeOf(live).toEqualTypeOf<ReadonlyArray<Item> | undefined>();
    const checkTypes = () => {
      // @ts-expect-error An optional connection needs an absence check.
      optional.map(({ node }) => node.id);
    };
    expect(checkTypes).toBeTypeOf('function');
    expect(absent).toBeUndefined();
    expect(empty).toBeUndefined();
    expect(next).toBeNull();
    expect(previous).toBeNull();
    return `${optional?.length ?? 'absent'}:${live?.length ?? 'absent'}`;
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  const render = (connection: ConnectionRef<'Comment'> | null | undefined) =>
    act(async () =>
      root.render(
        <FateClient client={client}>
          <Component connection={connection} />
        </FateClient>,
      ),
    );
  try {
    await render(undefined);
    expect(container.textContent).toBe('absent:absent');
    await render(loaded);
    expect(container.textContent).toBe('1:1');
    await render({ items: [] });
    expect(container.textContent).toBe('0:0');
    await render(null);
    expect(container.textContent).toBe('absent:absent');
    expect(fetchById).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});

test('optional or missing items are typed as potentially absent', async () => {
  const { client } = setup();
  const optional: { items?: ReadonlyArray<Item> } = {};
  const missing = { pagination: { hasNext: false, hasPrevious: false } };
  const Component = () => {
    const [items] = useListView(Selection, optional);
    const [withoutItems] = useListView(Selection, missing);
    expectTypeOf(items).toEqualTypeOf<ReadonlyArray<Item> | undefined>();
    expectTypeOf(withoutItems).toEqualTypeOf<undefined>();
    expect(items).toBeUndefined();
    expect(withoutItems).toBeUndefined();
    return null;
  };
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () =>
      root.render(
        <FateClient client={client}>
          <Component />
        </FateClient>,
      ),
    );
  } finally {
    await act(async () => root.unmount());
  }
});

test('nullable deferred connections are accepted and retain absence in list and live-list types', async () => {
  type Post = { __typename: 'Post'; comments: Array<Comment> | null; id: string };
  const PostView = view<Post>()({ comments: defer(Selection), id: true });
  const { client, fetchById } = setup();
  client.write('Post', { id: 'post' }, new Set(['id']));
  fetchById.mockResolvedValue([{ comments: null, id: 'post' }]);
  const postRef = client.ref('Post', 'post', PostView);
  const Component = () => {
    const post = useView(PostView, postRef);
    const [items] = useListView(Selection, post.comments);
    const [live] = useLiveListView(Selection, post.comments);
    expectTypeOf<Extract<typeof items, undefined>>().toEqualTypeOf<undefined>();
    expectTypeOf<Extract<typeof live, undefined>>().toEqualTypeOf<undefined>();
    expectTypeOf<NonNullable<typeof items>[number]['node']>().toEqualTypeOf<ViewRef<'Comment'>>();
    expect(items).toBeUndefined();
    expect(live).toBeUndefined();
    return 'absent';
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <FateClient client={client}>
          <Component />
        </FateClient>,
      ),
    );
    expect(container.textContent).toBe('absent');
    expect(fetchById).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
  }
});
