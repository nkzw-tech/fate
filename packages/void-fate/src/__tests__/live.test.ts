import { expect, test, vi } from 'vite-plus/test';
import { createVoidFateLive, defineVoidFateLiveRoute, type VoidFateLiveStream } from '../server.ts';

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
