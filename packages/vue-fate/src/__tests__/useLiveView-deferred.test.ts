/** @vitest-environment happy-dom */
import { createClient, defer, getSelectionPlan, view } from '@nkzw/fate';
import { expect, test, vi } from 'vite-plus/test';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { FateClient, useLiveView } from '../index.ts';

type User = { __typename: 'User'; id: string; name: string };
type Post = { __typename: 'Post'; id: string; author: User | null };

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
  const PostView = view<Post>()({ id: true, author: defer(UserView) });
  const unsubscribe = vi.fn();
  const subscribeById = vi.fn(() => unsubscribe);
  const client = createClient({
    roots: {},
    transport: { fetchById: async () => [], subscribeById },
    types: [{ type: 'Post', fields: { author: { type: 'User' } } }, { type: 'User' }],
  });
  const plan = getSelectionPlan(view<Post>()({ id: true, author: UserView }), null);
  client.write('Post', { id: 'p', author: { id: '1', name: 'Before' } }, plan.paths, plan);
  const parent = await client.readView(PostView, client.ref('Post', 'p', PostView));
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
    client.write('Post', { id: 'p', author: { id: '2', name: 'After' } }, plan.paths, plan);
    await resource.ready();
    await nextTick();
    expect(container.textContent).toBe('After');
    expect(subscribeById.mock.calls.at(-1)?.[1]).toBe('2');
  } finally {
    app.unmount();
  }
});
