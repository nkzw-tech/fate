import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { view } from '../view.ts';

test('concurrent view readers receive their own selected fields', async () => {
  type User = { __typename: 'User'; id: string; name: string; age: number };
  const Name = view<User>()({ name: true });
  const Profile = view<User>()({ name: true, age: true });
  let resolve!: (records: Array<{ id: string; name: string }>) => void;
  const fetchById = vi.fn(
    () =>
      new Promise<Array<{ id: string; name: string }>>((done) => {
        resolve = done;
      }),
  );
  const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'User' }] });
  client.write('User', { id: '1', age: 42 }, new Set(['id', 'age']));
  const first = client.readView(Name, client.ref('User', '1', Name));
  const second = client.readView(Profile, client.ref('User', '1', Profile));
  resolve([{ id: '1', name: 'Ada' }]);
  await first;
  expect((await second).data).toMatchObject({ name: 'Ada', age: 42 });
  expect(fetchById).toHaveBeenCalledTimes(1);
});
