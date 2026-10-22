/** @vitest-environment happy-dom */

import { clientRoot, createClient, type RequestStateOptions, type ViewRef, view } from '@nkzw/fate';
import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import {
  computed,
  createApp,
  createSSRApp,
  defineComponent,
  h,
  nextTick,
  ref,
  shallowRef,
  type MaybeRefOrGetter,
} from 'vue';
import { renderToString } from 'vue/server-renderer';
import { FateClient, useRequestState } from '../index.ts';

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
const mount = (options: MaybeRefOrGetter<RequestStateOptions> = {}) => {
  const { client, fetchQuery, roots } = setup();
  const provider = shallowRef(client);
  const tick = ref(0);
  let state!: ReturnType<typeof useRequestState<typeof request, typeof roots>>;
  const Component = defineComponent({
    setup() {
      state = useRequestState<typeof request, typeof roots>(() => {
        return tick.value >= 0 ? { viewer: { view: UserView } } : request;
      }, options);
      expectTypeOf(state.value.data?.viewer).toEqualTypeOf<ViewRef<'User'> | null | undefined>();
      return () => h('span', `${state.value.status}:${state.value.data?.viewer?.id ?? 'absent'}`);
    },
  });
  const container = document.createElement('div');
  const app = createApp({
    render: () => h(FateClient, { client: provider }, { default: () => h(Component) }),
  });
  app.mount(container);
  return { app, client, container, fetchQuery, provider, state, tick };
};

test('starts disabled requests when enabled without restarting equivalent inline selections', async () => {
  const enabled = ref(false);
  const { app, container, fetchQuery, state, tick } = mount(
    computed(() => ({ enabled: enabled.value })),
  );
  try {
    expect(container.textContent).toBe('disabled:absent');
    expect(fetchQuery).not.toHaveBeenCalled();
    await expect(state.value.refetch()).rejects.toThrow(/disabled/);
    enabled.value = true;
    await vi.waitFor(() => expect(container.textContent).toBe('ready:1'));
    const first = state.value;
    tick.value++;
    await nextTick();
    expect(state.value).toBe(first);
    expect(fetchQuery).toHaveBeenCalledTimes(1);
    enabled.value = false;
    await nextTick();
    expect(state.value.status).toBe('disabled');
    expect(state.value.data).toBeUndefined();
  } finally {
    app.unmount();
  }
});

test('observes cache-only misses and external nullable results without fetching', async () => {
  const { app, client, container, fetchQuery, state } = mount({ mode: 'cache-only' });
  try {
    expect(state.value.status).toBe('missing');
    expect(fetchQuery).not.toHaveBeenCalled();
    await expect(state.value.refetch()).rejects.toThrow(/cache-only/);
    await client.request(request);
    await nextTick();
    expect(container.textContent).toBe('ready:1');
    fetchQuery.mockResolvedValueOnce(null);
    await client.request(request, { mode: 'network-only' });
    await nextTick();
    expect(state.value.data?.viewer).toBeNull();
    state.dispose();
    const before = state.value;
    await client.request(request, { mode: 'network-only' });
    await nextTick();
    expect(state.value).toBe(before);
  } finally {
    app.unmount();
  }
});

test('retains data during refetch, exposes errors, retries, and switches provider clients', async () => {
  const { app, fetchQuery, provider, state } = mount();
  try {
    await vi.waitFor(() => expect(state.value.status).toBe('ready'));
    const pending = Promise.withResolvers<User | null>();
    fetchQuery.mockReturnValueOnce(pending.promise);
    const refresh = state.value.refetch();
    const failure = (async () => {
      await expect(refresh).rejects.toThrow('Offline');
    })();
    await vi.waitFor(() => expect(fetchQuery).toHaveBeenCalledTimes(2));
    expect(state.value).toMatchObject({
      data: { viewer: { id: '1' } },
      isFetching: true,
      status: 'ready',
    });
    pending.reject(new Error('Offline'));
    await failure;
    expect(state.value).toMatchObject({
      error: new Error('Offline'),
      isFetching: false,
      status: 'ready',
    });
    await state.value.refetch();
    expect(state.value.error).toBeUndefined();
    const other = setup();
    other.fetchQuery.mockResolvedValueOnce({ __typename: 'User', id: '2', name: 'Grace' });
    provider.value = other.client;
    await vi.waitFor(() => expect(state.value.data?.viewer?.id).toBe('2'));
    app.unmount();
    const before = state.value;
    await other.client.request(request, { mode: 'network-only' });
    expect(state.value).toBe(before);
  } finally {
    if (app._container) {
      app.unmount();
    }
  }
});

test('reports background revalidation failures while preserving cached data', async () => {
  const { client, fetchQuery, roots } = setup();
  await client.request(request);
  const pending = Promise.withResolvers<User | null>();
  fetchQuery.mockReturnValueOnce(pending.promise);
  let state!: ReturnType<typeof useRequestState<typeof request, typeof roots>>;
  const Component = defineComponent({
    setup() {
      state = useRequestState<typeof request, typeof roots>(request, {
        mode: 'stale-while-revalidate',
      });
      return () => h('span', state.value.status);
    },
  });
  const app = createApp({
    render: () => h(FateClient, { client }, { default: () => h(Component) }),
  });
  app.mount(document.createElement('div'));
  try {
    await vi.waitFor(() => expect(fetchQuery).toHaveBeenCalledTimes(2));
    expect(state.value).toMatchObject({ isFetching: true, status: 'ready' });
    pending.reject(new Error('Background failure'));
    await vi.waitFor(() =>
      expect(state.value).toMatchObject({
        error: new Error('Background failure'),
        isFetching: false,
        status: 'ready',
      }),
    );
  } finally {
    app.unmount();
  }
});

test.each([false, true])(
  'prefetches non-suspending request state during SSR with failure %s',
  async (fail) => {
    const { client, fetchQuery, roots } = setup();
    if (fail) {
      fetchQuery.mockRejectedValueOnce(new Error('Offline'));
    }
    const Component = defineComponent({
      setup() {
        const state = useRequestState<typeof request, typeof roots>(request);
        return () => h('span', state.value.status);
      },
    });
    const app = createSSRApp({
      render: () => h(FateClient, { client }, { default: () => h(Component) }),
    });
    expect(await renderToString(app)).toContain(fail ? 'error' : 'ready');
    expect(fetchQuery).toHaveBeenCalledTimes(1);
  },
);
