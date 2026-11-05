/** @vitest-environment happy-dom */
import { createClient, view } from '@nkzw/fate';
import { expect, test } from 'vite-plus/test';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { FateClient, useView } from '../index.ts';

type User = { __typename: 'User'; id: string; name: string };

const mount = (Component: any, client: any) => {
  const container = document.createElement('div');
  const app = createApp({
    render: () => h(FateClient, { client }, { default: () => h(Component) }),
  });
  app.mount(container);
  return { app, container };
};

test('useView must not miss writes before initial subscription', async () => {
  const UserView = view<User>()({ id: true, name: true });
  const client = createClient({
    roots: {},
    transport: { fetchById: async () => [] },
    types: [{ type: 'User' }],
  });
  client.write('User', { id: '1', name: 'Before' }, new Set(['id', 'name']));
  let resource: any;
  const Component = defineComponent({
    setup() {
      resource = useView(UserView, client.ref('User', '1', UserView));
      return () => h('span', resource.value?.name);
    },
  });
  const { app, container } = mount(Component, client);
  try {
    client.write('User', { id: '1', name: 'After' }, new Set(['id', 'name']));
    await resource.ready();
    await nextTick();
    expect(container.textContent).toBe('After');
  } finally {
    app.unmount();
  }
});
