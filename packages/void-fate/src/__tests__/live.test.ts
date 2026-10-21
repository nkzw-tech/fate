import { createClient, createHTTPTransport, mutation, view, type InferFateAPI } from '@nkzw/fate';
import { createFateServer } from '@nkzw/fate/server';
import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import {
  createVoidFateLive,
  defineVoidFateRoute,
  defineVoidFateLiveRoute,
  type VoidFateLiveStream,
} from '../server.ts';

const createTestStream = (publish = vi.fn(() => Promise.resolve())) =>
  ({
    connect: vi.fn(() => Promise.resolve(new Response('live'))),
    control: vi.fn(() => Promise.resolve(new Response('control'))),
    withEnv: vi.fn(() => ({ publish })),
  }) satisfies VoidFateLiveStream;

test('creates publish facades without defining a void/live stream', () => {
  expect(() => {
    createVoidFateLive();
    createVoidFateLive();
  }).not.toThrow();
});

test('does not fail requests when live publishing is unavailable', async () => {
  const stream = createTestStream(vi.fn(() => Promise.reject(new Error('unavailable'))));
  const { live, withContext } = createVoidFateLive();

  await expect(
    withContext({ env: {}, stream }, async () => {
      live.update('Post', 'post-1');
      return 'ok';
    }),
  ).resolves.toBe('ok');
});

test('publishes changed paths with entity live events', async () => {
  const publish = vi.fn(() => Promise.resolve());
  const stream = createTestStream(publish);
  const { live, withContext } = createVoidFateLive();

  await withContext({ env: {}, stream }, async () => {
    live.update('Post', 'post-1', { changed: ['likes'], eventId: 'event-1' });
  });

  expect(publish).toHaveBeenCalledWith(
    'entity:Post:post-1',
    { changed: ['likes'], data: undefined, id: 'post-1' },
    { eventId: 'event-1', type: 'update' },
  );
});

test('publishes connection events through the live facade without failing requests', async () => {
  const publish = vi.fn(() => Promise.resolve());
  const stream = createTestStream(publish);
  const { live, withContext } = createVoidFateLive();

  await expect(
    withContext({ env: {}, stream }, async () => {
      live.connection('posts').prependNode('Post', 'post-1');
      return 'ok';
    }),
  ).resolves.toBe('ok');
  expect(publish).toHaveBeenCalledOnce();
});

test('routes live endpoint requests to void/live', async () => {
  const connect = vi.fn(() => Promise.resolve(new Response('live')));
  const control = vi.fn(() => Promise.resolve(new Response('control')));
  const route = defineVoidFateLiveRoute({
    connect,
    control,
    withEnv: vi.fn(() => ({ publish: vi.fn(() => Promise.resolve()) })),
  });

  const response = (await route.GET({
    env: {},
    req: { raw: new Request('https://example.com/fate-live') },
  } as Parameters<typeof route.GET>[0])) as Response;

  expect(await response.text()).toBe('live');
  expect(connect).toHaveBeenCalledOnce();
  expect(control).not.toHaveBeenCalled();
});

test('bound actions retain selected result types through the Void RPC route', async () => {
  type Note = { __typename: 'Note'; body: string; id: string; title: string };
  const resolve = vi.fn(({ input }: { input: { id: string }; select: Array<string> }) => ({
    body: 'Unselected',
    id: input.id,
    title: 'Saved',
  }));
  const server = createFateServer({
    mutations: { edit: { resolve, type: 'Note' } },
    roots: {},
    sources: {
      getSource: () => {
        throw new Error('This test only executes mutations.');
      },
      registry: new Map(),
    },
  });
  type API = InferFateAPI<typeof server>;
  const route = defineVoidFateRoute(server, createVoidFateLive(), { stream: createTestStream() });
  const mutations = {
    edit: mutation<Note, { id: string }, API['mutations']['edit']['output']>('Note'),
  };
  const roots = {};
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    roots,
    transport: createHTTPTransport<API>({
      fetch: async (input, init) =>
        (await route.POST({
          env: {},
          req: { raw: new Request(input, init) },
        } as Parameters<typeof route.POST>[0])) as Response,
      live: false,
      url: 'http://test.local/fate',
    }),
    types: [{ type: 'Note' }],
  });
  const response = await client.actions.edit.with(view<Note>()({ title: true }))(null, {
    input: { id: '1' },
  });
  if (!response.error) {
    expectTypeOf(response.result).toEqualTypeOf<{ id: string; title: string }>();
    // @ts-expect-error Void actions also exclude fields outside the bound selection.
    void response.result.body;
  }
  expect(response).toMatchObject({ error: undefined, result: { id: '1', title: 'Saved' } });
  expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ select: ['title'] }));
});
