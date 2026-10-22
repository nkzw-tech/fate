import { expect, test, vi } from 'vite-plus/test';
import { clientRoot, createClient, view } from '../index.ts';

type User = { __typename: 'User'; id: string; name: string };
const UserView = view<User>()({ id: true, name: true });
const request = { viewer: { view: UserView } };
const setup = () => {
  const fetchQuery = vi.fn(async () => ({ id: '1', name: 'Ada' }));
  const client = createClient({
    roots: { other: clientRoot<User, 'User'>('User'), viewer: clientRoot<User, 'User'>('User') },
    transport: { fetchById: vi.fn(async () => []), fetchQuery },
    types: [{ type: 'User' }],
  });
  return { client, fetchQuery };
};

test.each([undefined, 5000])(
  'releasing an older preparation preserves its replacement (timeout=%s)',
  async (timeout) => {
    const { client, fetchQuery } = setup();
    const options = { mode: 'network-only', timeout } as const;
    const first = client.prepareRequestForRender(request, options);
    await first.promise;
    client.releaseRequestKey(first.requestKey, 'network-only');

    const pending = Promise.withResolvers<{ id: string; name: string }>();
    fetchQuery.mockReturnValueOnce(pending.promise);
    const replacement = client.prepareRequestForRender(request, options);

    try {
      expect(replacement.promise).not.toBe(first.promise);
      client.releaseRequestKey(first.requestKey, 'network-only', first.promise);
      expect(client.prepareRequestForRender(request, options).promise).toBe(replacement.promise);
      expect(fetchQuery).toHaveBeenCalledTimes(2);
      pending.resolve({ id: '1', name: 'Grace' });
      await expect(replacement.promise).resolves.toHaveProperty('viewer.id', '1');

      client.releaseRequestKey(replacement.requestKey, 'network-only', replacement.promise);
      const next = client.prepareRequestForRender(request, options);
      expect(next.promise).not.toBe(replacement.promise);
      await next.promise;
    } finally {
      pending.resolve({ id: '1', name: 'Grace' });
      await replacement.promise;
    }
  },
);

test.each(['cache-first', 'stale-while-revalidate'] as const)(
  'a successful explicit refetch recovers a rejected %s render request',
  async (mode) => {
    const { client, fetchQuery } = setup();
    const error = new Error('Unavailable');
    fetchQuery.mockRejectedValueOnce(error);
    const failed = client.prepareRequestForRender(request, { mode }).promise;
    await expect(failed).rejects.toBe(error);
    expect(client.prepareRequestForRender(request, { mode }).promise).toBe(failed);
    fetchQuery.mockRejectedValueOnce(error);
    await expect(client.request(request, { mode: 'network-only' })).rejects.toBe(error);
    expect(client.prepareRequestForRender(request, { mode }).promise).toBe(failed);
    await client.request(request, { mode: 'network-only' });
    const recovered = client.prepareRequestForRender(request, { mode }).promise;
    await expect(recovered).resolves.toHaveProperty('viewer.id', '1');
    expect(recovered).not.toBe(failed);
    expect(client.prepareRequestForRender(request, { mode }).promise).toBe(recovered);
  },
);

test('recovery preserves fulfilled render gates and unrelated rejected requests', async () => {
  const { client, fetchQuery } = setup();
  const ready = client.prepareRequestForRender(request, { mode: 'cache-first' }).promise;
  await ready;
  const other = { other: { view: UserView } };
  const error = new Error('Other failed');
  fetchQuery.mockRejectedValueOnce(error);
  const failed = client.prepareRequestForRender(other, { mode: 'cache-first' }).promise;
  await expect(failed).rejects.toBe(error);
  const pending = Promise.withResolvers<{ id: string; name: string }>();
  fetchQuery.mockReturnValueOnce(pending.promise);
  const refresh = client.request(request, { mode: 'network-only' });
  expect(client.prepareRequestForRender(request, { mode: 'cache-first' }).promise).toBe(ready);
  pending.resolve({ id: '1', name: 'Grace' });
  await refresh;
  expect(client.prepareRequestForRender(request, { mode: 'cache-first' }).promise).toBe(ready);
  expect(client.prepareRequestForRender(other, { mode: 'cache-first' }).promise).toBe(failed);
  expect(fetchQuery).toHaveBeenCalledTimes(3);
});
