import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { view } from '../view.ts';

test('concurrent view readers receive their own selected fields', async () => {
  type User = { __typename: 'User'; age: number; id: string; name: string };
  const Name = view<User>()({ name: true });
  const Profile = view<User>()({ age: true, name: true });
  let resolve!: (records: Array<{ id: string; name: string }>) => void;
  const fetchById = vi.fn(
    () =>
      new Promise<Array<{ id: string; name: string }>>((done) => {
        resolve = done;
      }),
  );
  const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'User' }] });
  client.write('User', { age: 42, id: '1' }, new Set(['id', 'age']));
  const first = client.readView(Name, client.ref('User', '1', Name));
  const second = client.readView(Profile, client.ref('User', '1', Profile));
  resolve([{ id: '1', name: 'Ada' }]);
  await first;
  expect((await second).data).toMatchObject({ age: 42, name: 'Ada' });
  expect(fetchById).toHaveBeenCalledTimes(1);
});
