/** @vitest-environment happy-dom */

import { clientRoot, createClient, view, type ViewRef } from '@nkzw/fate';
import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from 'vue';
import { FateClient, useRefetch, useRequest } from '../index.ts';

type User = { __typename: 'User'; id: string; name: string };
const UserView = view<User>()({ id: true, name: true });
const setup = () => {
  const roots = { viewer: clientRoot<User | null, 'User'>('User') };
  const fetchQuery = vi.fn(async (): Promise<User | null> => ({
    __typename: 'User',
    id: '1',
    name: 'Ada',
  }));
  const client = createClient({
    roots,
    transport: { fetchById: async () => [], fetchQuery },
    types: [{ type: 'User' }],
  });
  return { client, fetchQuery, roots };
};

test('fetches only when called and reads current reactive requests, options, and providers', async () => {
  const { client, fetchQuery, roots } = setup();
  const provider = shallowRef(client);
  const name = ref('Ada');
  const maxAge = ref(1000);
  const timeout = ref(1000);
  const controller = new AbortController();
  const request = () => ({ viewer: { args: { name: name.value }, view: UserView } });
  let refresh!: ReturnType<typeof useRefetch<ReturnType<typeof request>, typeof roots>>;
  const Component = defineComponent({
    setup() {
      refresh = useRefetch<ReturnType<typeof request>, typeof roots>(request, () => ({
        persist: { maxAge: maxAge.value },
        signal: controller.signal,
        timeout: timeout.value,
      }));
      expectTypeOf(refresh)
        .returns.resolves.toHaveProperty('viewer')
        .toEqualTypeOf<ViewRef<'User'> | null>();
      return () => h('span', 'Ready');
    },
  });
  const app = createApp({
    render: () => h(FateClient, { client: provider }, { default: () => h(Component) }),
  });
  app.mount(document.createElement('div'));
  try {
    expect(fetchQuery).not.toHaveBeenCalled();
    const first = refresh;
    const requestSpy = vi.spyOn(client, 'request');
    await refresh();
    expect(requestSpy).toHaveBeenLastCalledWith(expect.anything(), {
      mode: 'network-only',
      persist: { maxAge: 1000 },
      signal: controller.signal,
      timeout: 1000,
    });
    expect(fetchQuery).toHaveBeenLastCalledWith(
      'viewer',
      expect.anything(),
      { name: 'Ada' },
      expect.objectContaining({ signal: expect.anything() }),
    );
    name.value = 'Grace';
    maxAge.value = 2000;
    timeout.value = 2000;
    await refresh();
    expect(requestSpy).toHaveBeenLastCalledWith(expect.anything(), {
      mode: 'network-only',
      persist: { maxAge: 2000 },
      signal: controller.signal,
      timeout: 2000,
    });
    expect(fetchQuery).toHaveBeenLastCalledWith(
      'viewer',
      expect.anything(),
      { name: 'Grace' },
      expect.objectContaining({ signal: expect.anything() }),
    );
    const other = setup();
    provider.value = other.client;
    await refresh();
    expect(refresh).toBe(first);
    expect(other.fetchQuery).toHaveBeenCalledTimes(1);
    expect(other.fetchQuery).toHaveBeenLastCalledWith(
      'viewer',
      expect.anything(),
      { name: 'Grace' },
      expect.objectContaining({ signal: expect.anything() }),
    );
  } finally {
    app.unmount();
  }
});

test.each(['cache-first', 'network-only'] as const)(
  'refreshes a %s request without losing data, shares pending work, and retries failures',
  async (mode) => {
    const { client, fetchQuery, roots } = setup();
    const request = { viewer: { view: UserView } };
    let refresh!: ReturnType<typeof useRefetch<typeof request, typeof roots>>;
    let resource!: ReturnType<typeof useRequest<typeof request, typeof roots>>;
    const Component = defineComponent({
      setup() {
        refresh = useRefetch<typeof request, typeof roots>(request);
        resource = useRequest<typeof request, typeof roots>(request, { mode });
        return () => h('span', resource.data.value?.viewer?.id ?? 'absent');
      },
    });
    const container = document.createElement('div');
    const app = createApp({
      render: () => h(FateClient, { client }, { default: () => h(Component) }),
    });
    app.mount(container);
    try {
      await resource.ready();
      await nextTick();
      expect(container.textContent).toBe('1');
      const pending = Promise.withResolvers<User | null>();
      fetchQuery.mockReturnValueOnce(pending.promise);
      const first = refresh();
      const duplicate = refresh();
      await nextTick();
      expect(fetchQuery).toHaveBeenCalledTimes(2);
      expect(container.textContent).toBe('1');
      pending.resolve({ __typename: 'User', id: '2', name: 'Grace' });
      await Promise.all([first, duplicate]);
      await nextTick();
      expect(container.textContent).toBe('2');
      const error = new Error('Offline');
      fetchQuery.mockRejectedValueOnce(error);
      await expect(refresh()).rejects.toBe(error);
      await nextTick();
      expect(container.textContent).toBe('2');
      fetchQuery.mockResolvedValueOnce(null);
      expect(await refresh()).toEqual({ viewer: null });
      await nextTick();
      expect(container.textContent).toBe('absent');
    } finally {
      app.unmount();
    }
  },
);
