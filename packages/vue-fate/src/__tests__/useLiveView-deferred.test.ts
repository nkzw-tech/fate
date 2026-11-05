/** @vitest-environment happy-dom */
import { createClient, defer, getSelectionPlan, view, type ViewSelection } from '@nkzw/fate';
import { expect, test, vi } from 'vite-plus/test';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { FateClient, useLiveView } from '../index.ts';

type User = { __typename: 'User'; id: string; name: string };
type Post = { __typename: 'Post'; author: User | null; id: string };

const mount = (Component: any, client: any) => {
  const container = document.createElement('div');
  const app = createApp({
    render: () => h(FateClient, { client }, { default: () => h(Component) }),
  });
  app.mount(container);
  return { app, container };
};

test('live deferred ref must switch subscriptions after relation changes', async () => {
  const UserView = view<User>()({ id: true, name: true });
  const PostView = view<Post>()({ author: defer(UserView), id: true });
  const unsubscribe = vi.fn();
  const subscribeById = vi.fn((_type: string, _id: string | number) => unsubscribe);
  const client = createClient({
    roots: {},
    transport: { fetchById: async () => [], subscribeById },
    types: [{ fields: { author: { type: 'User' } }, type: 'Post' }, { type: 'User' }],
  });
  const plan = getSelectionPlan(view<Post>()({ author: UserView, id: true }), null);
  client.write('Post', { author: { id: '1', name: 'Before' }, id: 'p' }, plan.paths, plan);
  const parent = await client.readView<Post, ViewSelection<typeof PostView>, typeof PostView>(
    PostView,
    client.ref('Post', 'p', PostView),
  );
  let resource: any;
  const Component = defineComponent({
    setup() {
      resource = useLiveView(UserView, parent.data.author as any);
      return () => h('span', resource.value?.name);
    },
  });
  const { app, container } = mount(Component, client);
  try {
    await resource.ready();
    await nextTick();
    expect(container.textContent).toBe('Before');
    expect(subscribeById.mock.calls[0]?.[1]).toBe('1');
    client.write('Post', { author: { id: '2', name: 'After' }, id: 'p' }, plan.paths, plan);
    await resource.ready();
    await nextTick();
    expect(container.textContent).toBe('After');
    expect(subscribeById.mock.calls.at(-1)?.[1]).toBe('2');
  } finally {
    app.unmount();
  }
});
