/** @vitest-environment happy-dom */
import { createClient, defer, getSelectionPlan, view, type ViewSelection } from '@nkzw/fate';
import { expect, test } from 'vite-plus/test';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { FateClient } from '../index.ts';

const mount = (Component: any, client: any) => {
  const container = document.createElement('div');
  const app = createApp({
    render: () => h(FateClient, { client }, { default: () => h(Component) }),
  });
  app.mount(container);
  return { app, container };
};

test('deferred connection must observe a null-to-list transition', async () => {
  const { useListView } = await import('../useListView.ts');
  type Comment = { __typename: 'Comment'; content: string; id: string };
  type PostWithComments = { __typename: 'Post'; comments: Array<Comment> | null; id: string };
  const CommentView = view<Comment>()({ content: true, id: true });
  const connection = {
    args: { first: 1 },
    items: { cursor: true, node: CommentView },
    pagination: { hasNext: true, hasPrevious: true, nextCursor: true, previousCursor: true },
  } as const;
  const PostView = view<PostWithComments>()({ comments: defer(connection), id: true });
  const plan = getSelectionPlan(view<PostWithComments>()({ comments: connection, id: true }), null);
  const client = createClient({
    roots: {},
    transport: { fetchById: async () => [] },
    types: [{ fields: { comments: { listOf: 'Comment' } }, type: 'Post' }, { type: 'Comment' }],
  });
  client.write('Post', { comments: null, id: 'p' }, plan.paths, plan);
  const parent = await client.readView<
    PostWithComments,
    ViewSelection<typeof PostView>,
    typeof PostView
  >(PostView, client.ref('Post', 'p', PostView));
  let resource: any;
  const Component = defineComponent({
    setup() {
      resource = useListView(connection, parent.data.comments);
      return () =>
        h('span', resource[0].value?.map(({ node }: any) => node.id).join(',') ?? 'empty');
    },
  });
  const { app, container } = mount(Component, client);
  try {
    await resource.ready();
    await nextTick();
    expect(container.textContent).toBe('empty');
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
    expect(container.textContent).toBe('1');
  } finally {
    app.unmount();
  }
});
