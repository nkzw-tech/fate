/** @vitest-environment happy-dom */
import { createClient, defer, getSelectionPlan, view, type ViewSelection } from '@nkzw/fate';
import { act, startTransition, StrictMode, Suspense, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';
import { FateClient } from '../context.tsx';
import { useListView } from '../useListView.tsx';
import { useLiveListView } from '../useLiveListView.tsx';
// @ts-expect-error test setup
global.IS_REACT_ACT_ENVIRONMENT = true;

type Comment = { __typename: 'Comment'; id: string };
type Post = { __typename: 'Post'; comments: Array<Comment> | null; id: string };
const CommentView = view<Comment>()({ id: true });
const selection = {
  args: { first: 1 },
  items: { cursor: true, node: CommentView },
  pagination: { hasNext: true, hasPrevious: true, nextCursor: true, previousCursor: true },
} as const;
const PostView = view<Post>()({ comments: defer(selection) });
const plan = getSelectionPlan(view<Post>()({ comments: selection, id: true }), null);
const postWithComment = (id: string) => ({
  comments: {
    items: [{ cursor: id, node: { id: `comment-${id}` } }],
    pagination: { hasNext: false, hasPrevious: false },
  },
  id,
});

const setup = async (empty = false) => {
  const pending = Promise.withResolvers<Array<ReturnType<typeof postWithComment>>>();
  const fetchById = vi.fn(() => pending.promise);
  const subscribeConnection = vi.fn(() => () => {});
  const client = createClient({
    roots: {},
    transport: { fetchById, subscribeConnection },
    types: [{ fields: { comments: { listOf: 'Comment' } }, type: 'Post' }, { type: 'Comment' }],
  });
  const readPost = (id: string) =>
    client.readView<Post, ViewSelection<typeof PostView>, typeof PostView>(
      PostView,
      client.ref('Post', id, PostView),
    );
  client.write(
    'Post',
    empty ? { comments: null, id: 'a' } : postWithComment('a'),
    plan.paths,
    plan,
  );
  client.write('Post', postWithComment('b'), plan.paths, plan);
  client.write('Post', { id: 'pending' }, new Set(['id']));
  const [a, b, waiting] = await Promise.all([readPost('a'), readPost('b'), readPost('pending')]);
  return { a, b, client, fetchById, pending, subscribeConnection, waiting };
};

const hooks = [
  ['list', useListView],
  ['live list', useLiveListView],
] as const;

test.each(hooks)(
  'observes a deferred %s changing from null to populated',
  async (kind, useList) => {
    const { a, client, fetchById, subscribeConnection } = await setup(true);
    function Reader() {
      const [items] = useList(selection, a.data.comments);
      return items?.map(({ node }) => node.id).join(',') ?? 'empty';
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <StrictMode>
            <FateClient client={client}>
              <Suspense fallback="loading">
                <Reader />
              </Suspense>
            </FateClient>
          </StrictMode>,
        ),
      );
      expect(container.textContent).toBe('empty');
      expect(subscribeConnection).not.toHaveBeenCalled();

      await act(async () => client.write('Post', postWithComment('a'), plan.paths, plan));
      expect(container.textContent).toBe('comment-a');
      expect(fetchById).not.toHaveBeenCalled();
      expect(subscribeConnection).toHaveBeenCalledTimes(kind === 'live list' ? 1 : 0);

      await act(async () => client.write('Post', { comments: null, id: 'a' }, plan.paths, plan));
      expect(container.textContent).toBe('empty');
    } finally {
      await act(async () => root.unmount());
    }
  },
);

test.each(hooks)(
  'commits only the current owner’s items after an urgent deferred %s switch',
  async (_, useList) => {
    const { a, b, client, fetchById } = await setup();
    const commits: Array<string> = [];
    function Reader({ post }: { post: typeof a }) {
      const [items] = useList(selection, post.data.comments);
      const ids = items?.map(({ node }) => node.id).join(',');
      useLayoutEffect(() => {
        commits.push(ids ?? 'empty');
      });
      return ids;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    const render = (post: typeof a) =>
      root.render(
        <StrictMode>
          <FateClient client={client}>
            <Suspense fallback="loading">
              <Reader post={post} />
            </Suspense>
          </FateClient>
        </StrictMode>,
      );
    try {
      await act(async () => render(a));
      expect(container.textContent).toBe('comment-a');
      commits.length = 0;
      await act(async () => render(b));
      expect(new Set(commits)).toEqual(new Set(['comment-b']));
      expect(fetchById).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  },
);

test.each(hooks)(
  'keeps committed deferred %s content during a superseded transition',
  async (kind, useList) => {
    const { a, b, client, fetchById, pending, subscribeConnection, waiting } = await setup();
    function Reader({ post }: { post: typeof a }) {
      const [items] = useList(selection, post.data.comments);
      return items?.map(({ node }) => node.id).join(',');
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    const render = (post: typeof a) =>
      root.render(
        <StrictMode>
          <FateClient client={client}>
            <Suspense fallback="loading">
              <Reader post={post} />
            </Suspense>
          </FateClient>
        </StrictMode>,
      );
    try {
      await act(async () => render(a));
      await act(async () => startTransition(() => render(waiting)));
      expect(container.textContent).toBe('comment-a');
      expect(fetchById).toHaveBeenCalledTimes(1);

      // The committed reader continues receiving cache updates during the transition.
      const update = { ...postWithComment('updated'), id: 'a' };
      await act(async () => client.write('Post', update, plan.paths, plan));
      expect(container.textContent).toBe('comment-updated');

      await act(async () => render(b));
      expect(container.textContent).toBe('comment-b');
      await act(async () => pending.resolve([postWithComment('pending')]));
      expect(container.textContent).toBe('comment-b');
      expect(fetchById).toHaveBeenCalledTimes(1);
      expect(subscribeConnection).toHaveBeenCalledTimes(kind === 'live list' ? 2 : 0);
    } finally {
      await act(async () => root.unmount());
    }
  },
);
