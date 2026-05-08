import { expect, test, vi } from 'vite-plus/test';
import { live, withFateLiveContext } from '../live.ts';

test('does not fail requests when live publishing is unavailable', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch');

  await expect(
    withFateLiveContext({ env: {}, origin: 'https://example.com' }, async () => {
      live.update('Post', 'post-1');
      return 'ok';
    }),
  ).resolves.toBe('ok');

  expect(fetch).not.toHaveBeenCalled();
  fetch.mockRestore();
});

test('does not fail requests when live publishing rejects', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 500 }));

  await expect(
    withFateLiveContext(
      { env: { __VOID_PROXY_TOKEN: 'token' }, origin: 'https://example.com' },
      async () => {
        live.update('Post', 'post-1');
        return 'ok';
      },
    ),
  ).resolves.toBe('ok');

  expect(fetch).toHaveBeenCalledOnce();
  fetch.mockRestore();
});
