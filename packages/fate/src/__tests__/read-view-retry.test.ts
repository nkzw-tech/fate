import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { view } from '../view.ts';

test('retries a failed view read without retaining its rejected in-flight request', async () => {
  type User = { __typename: 'User'; id: string; name: string };
  const error = new Error('Request failed');
  const fetchById = vi
    .fn()
    .mockRejectedValueOnce(error)
    .mockResolvedValue([{ id: '1', name: 'Recovered' }]);
  const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'User' }] });
  const UserView = view<User>()({ name: true });
  const ref = client.ref('User', '1', UserView);
  const first = client.readView(UserView, ref);
  expect(client.readView(UserView, ref)).toBe(first);
  await expect(first).rejects.toBe(error);
  expect(fetchById).toHaveBeenCalledTimes(1);
  expect((await client.readView(UserView, ref)).data).toMatchObject({ name: 'Recovered' });
  expect(fetchById).toHaveBeenCalledTimes(2);
  expect((await client.readView(UserView, ref)).data).toMatchObject({ name: 'Recovered' });
  expect(fetchById).toHaveBeenCalledTimes(2);
});
