/** @vitest-environment happy-dom */

import { clientRoot, clientValueRoot, createClient, view } from '@nkzw/fate';
import { expect, test, vi } from 'vite-plus/test';
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from 'vue';
import { FateClient, useRequest } from '../index.ts';

type User = { __typename: 'User'; id: string; name: string };
const UserView = view<User>()({ id: true, name: true });
const request = { viewer: { view: UserView } };
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

test.each(['cache-first', 'network-only', 'stale-while-revalidate'] as const)(
  'updates %s root results after external refreshes and releases observers on disposal',
  async (mode) => {
    const { client, fetchQuery, roots } = setup();
    let resource!: ReturnType<typeof useRequest<typeof request, typeof roots>>;
    const Component = defineComponent({
      setup() {
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
      fetchQuery.mockResolvedValueOnce({ __typename: 'User', id: '2', name: 'Grace' });
      await client.request(request, { mode: 'network-only' });
      await nextTick();
      expect(container.textContent).toBe('2');
      fetchQuery.mockResolvedValueOnce(null);
      await client.request(request, { mode: 'network-only' });
      await nextTick();
      expect(container.textContent).toBe('absent');
      resource.dispose();
      const previous = resource.data.value;
      await client.request(request, { mode: 'network-only' });
      await nextTick();
      expect(resource.data.value).toBe(previous);
    } finally {
      app.unmount();
    }
  },
);

test('observes background revalidation of opaque value roots', async () => {
  const roots = { value: clientValueRoot<string>() };
  const fetchQuery = vi.fn(async () => 'before');
  const client = createClient({
    roots,
    transport: { fetchById: async () => [], fetchQuery },
    types: [],
  });
  const request = { value: { value: true } } as const;
  await client.request(request);
  const response = Promise.withResolvers<string>();
  fetchQuery.mockReturnValueOnce(response.promise);
  let resource!: ReturnType<typeof useRequest<typeof request, typeof roots>>;
  const Component = defineComponent({
    setup() {
      resource = useRequest<typeof request, typeof roots>(request, {
        mode: 'stale-while-revalidate',
      });
      return () => h('span', resource.data.value?.value);
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
    expect(container.textContent).toBe('before');
    response.resolve('after');
    await vi.waitFor(() => expect(container.textContent).toBe('after'));
    expect(fetchQuery).toHaveBeenCalledTimes(2);
  } finally {
    app.unmount();
  }
});

test.each(['network-only', 'stale-while-revalidate'] as const)(
  'a new %s reader revalidates after the shared request settles',
  async (mode) => {
    const { client, fetchQuery, roots } = setup();
    const first = Promise.withResolvers<User>();
    fetchQuery.mockReturnValueOnce(first.promise);
    const readers = ref(1);
    const resources: Array<ReturnType<typeof useRequest<typeof request, typeof roots>>> = [];
    const Reader = defineComponent({
      setup() {
        resources.push(useRequest<typeof request, typeof roots>(request, { mode }));
        return () => null;
      },
    });
    const app = createApp({
      render: () =>
        h(
          FateClient,
          { client },
          {
            default: () => Array.from({ length: readers.value }, (_, key) => h(Reader, { key })),
          },
        ),
    });
    app.mount(document.createElement('div'));
    try {
      readers.value = 2;
      await nextTick();
      expect(fetchQuery).toHaveBeenCalledOnce();
      first.resolve({ __typename: 'User', id: '1', name: 'Ada' });
      await Promise.all(resources.map((resource) => resource.ready()));

      fetchQuery.mockResolvedValue({ __typename: 'User', id: '2', name: 'Grace' });
      readers.value = 3;
      await nextTick();
      const result = await resources[2].ready();
      expect(fetchQuery).toHaveBeenCalledTimes(2);
      if (mode === 'network-only') {
        expect(result.viewer?.id).toBe('2');
      }
      await vi.waitFor(() => expect(resources[0].data.value?.viewer?.id).toBe('2'));
    } finally {
      app.unmount();
    }
  },
);

test('switches observers with the provider and ignores late results from the previous client', async () => {
  const first = setup();
  const second = setup();
  second.fetchQuery.mockResolvedValue({ __typename: 'User', id: '2', name: 'Grace' });
  const response = Promise.withResolvers<User | null>();
  first.fetchQuery.mockReturnValueOnce(response.promise);
  const provider = shallowRef(first.client);
  let resource!: ReturnType<typeof useRequest<typeof request, typeof first.roots>>;
  const Component = defineComponent({
    setup() {
      resource = useRequest<typeof request, typeof first.roots>(request);
      return () => h('span', resource.data.value?.viewer?.id ?? 'absent');
    },
  });
  const container = document.createElement('div');
  const app = createApp({
    render: () => h(FateClient, { client: provider }, { default: () => h(Component) }),
  });
  app.mount(container);
  try {
    provider.value = second.client;
    await nextTick();
    await resource.ready();
    response.resolve({ __typename: 'User', id: '1', name: 'Ada' });
    await vi.waitFor(() => expect(container.textContent).toBe('2'));
    await first.client.request(request, { mode: 'network-only' });
    await nextTick();
    expect(container.textContent).toBe('2');
  } finally {
    app.unmount();
  }
});
