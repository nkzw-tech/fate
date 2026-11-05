/** @vitest-environment happy-dom */
import { createClient, defer, getSelectionPlan, view, type ViewSelection } from '@nkzw/fate';
import { act, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vite-plus/test';
import { FateClient } from '../context.tsx';
import { useListView } from '../useListView.tsx';
// @ts-expect-error test setup
global.IS_REACT_ACT_ENVIRONMENT = true;

test('deferred connection must observe a null-to-list transition', async () => {
  type Comment = { __typename: 'Comment'; content: string; id: string };
  type Post = { __typename: 'Post'; comments: Array<Comment> | null; id: string };
  const CommentView = view<Comment>()({ content: true, id: true });
  const connection = {
    args: { first: 1 },
    items: { cursor: true, node: CommentView },
    pagination: { hasNext: true, hasPrevious: true, nextCursor: true, previousCursor: true },
  } as const;
  const PostView = view<Post>()({ comments: defer(connection), id: true });
  const plan = getSelectionPlan(view<Post>()({ comments: connection, id: true }), null);
  const client = createClient({
    roots: {},
    transport: { fetchById: async () => [] },
    types: [{ fields: { comments: { listOf: 'Comment' } }, type: 'Post' }, { type: 'Comment' }],
  });
  client.write('Post', { comments: null, id: 'p' }, plan.paths, plan);
  const parent = await client.readView<Post, ViewSelection<typeof PostView>, typeof PostView>(
    PostView,
    client.ref('Post', 'p', PostView),
  );
  const Component = () => {
    const [items] = useListView(connection, parent.data.comments);
    return <span>{items?.map(({ node }) => node.id).join(',') ?? 'empty'}</span>;
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <FateClient client={client}>
          <Suspense fallback="loading">
            <Component />
          </Suspense>
        </FateClient>,
      ),
    );
    expect(container.textContent).toBe('empty');
    await act(async () => {
      client.write(
        'Post',
        {
          comments: {
            items: [{ cursor: 'c1', node: { content: 'Hi', id: '1' } }],
            pagination: { hasNext: false, hasPrevious: false },
          },
          id: 'p',
        },
        plan.paths,
        plan,
      );
    });
    expect(container.textContent).toBe('1');
  } finally {
    await act(async () => root.unmount());
  }
});
