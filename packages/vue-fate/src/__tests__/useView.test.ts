/** @vitest-environment happy-dom */

import { createClient, getSelectionPlan, view, when } from '@nkzw/fate';
import { expect, test, vi } from 'vite-plus/test';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { FateClient, useView } from '../index.ts';

type User = { __typename: 'User'; email: string; id: string; name: string };

test('replaces selected paths when conditional fields change on the same entity', async () => {
  const UserView = view<User>()(({ enabled }: { enabled: boolean }) => ({
    email: when(enabled, true),
    id: true,
    name: true,
  }));
  const client = createClient({
    roots: {},
    transport: { fetchById: async () => [] },
    types: [{ type: 'User' }],
  });
  client.write('User', { email: 'before', id: '1', name: 'Ada' }, new Set(['id', 'name', 'email']));
  const enabled = ref(false);
  const subscribe = vi.spyOn(client.store, 'subscribe');
  const read = vi.spyOn(client, 'readView');
  let resource!: ReturnType<typeof useView<typeof UserView>>;
  const Component = defineComponent({
    setup() {
      resource = useView(UserView, () =>
        client.ref('User', '1', UserView({ enabled: enabled.value })),
      );
      return () => h('span', resource.value?.email ?? 'absent');
    },
  });
  const container = document.createElement('div');
  const app = createApp({
    render: () => h(FateClient, { client }, { default: () => h(Component) }),
  });
  app.mount(container);
  try {
    await resource.ready();
    expect(resource.value?.email).toBeUndefined();
    enabled.value = true;
    await nextTick();
    await resource.ready();
    expect(resource.value?.email).toBe('before');
    client.write('User', { email: 'after', id: '1' }, new Set(['email']));
    await vi.waitFor(() => expect(container.textContent).toBe('after'));
    expect(subscribe).toHaveBeenCalledTimes(2);
    enabled.value = false;
    await nextTick();
    await resource.ready();
    expect(resource.value?.email).toBeUndefined();
    const reads = read.mock.calls.length;
    client.write('User', { email: 'unselected', id: '1' }, new Set(['email']));
    await nextTick();
    expect(read).toHaveBeenCalledTimes(reads);
    expect(subscribe).toHaveBeenCalledTimes(3);
  } finally {
    app.unmount();
  }
});

test('switches subscriptions between parameter bindings without keeping old field paths', async () => {
  const Name = view<User>()(({ locale }: { locale: string }) => ({ name: { args: { locale } } }));
  const fetchById = vi.fn(
    async (
      _type: string,
      ids: Array<string | number>,
      _select: Set<string>,
      args?: Record<string, unknown>,
    ) => ids.map((id) => ({ id, name: (args?.name as { locale: string } | undefined)?.locale })),
  );
  const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'User' }] });
  const locale = ref('en');
  let resource!: ReturnType<typeof useView<typeof Name>>;
  const Component = defineComponent({
    setup() {
      resource = useView(Name, () => client.ref('User', '1', Name({ locale: locale.value })));
      return () => h('span', resource.value?.name);
    },
  });
  const container = document.createElement('div');
  const app = createApp({
    render: () => h(FateClient, { client }, { default: () => h(Component) }),
  });
  app.mount(container);
  try {
    await resource.ready();
    locale.value = 'ja';
    await nextTick();
    await resource.ready();
    expect(resource.value?.name).toBe('ja');
    const read = vi.spyOn(client, 'readView');
    client.write(
      'User',
      { id: '1', name: 'English' },
      new Set(['name']),
      getSelectionPlan(Name({ locale: 'en' }), null),
    );
    await nextTick();
    expect(read).not.toHaveBeenCalled();
    client.write(
      'User',
      { id: '1', name: 'Japanese' },
      new Set(['name']),
      getSelectionPlan(Name({ locale: 'ja' }), null),
    );
    await vi.waitFor(() => expect(container.textContent).toBe('Japanese'));
  } finally {
    app.unmount();
  }
});
