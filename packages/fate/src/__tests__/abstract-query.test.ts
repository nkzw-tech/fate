import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { clientRoot } from '../root.ts';
import { view } from '../view.ts';

test('abstract query results retain their concrete reference identity', async () => {
  type User = { __typename: 'User'; id: string; name: string };
  const UserView = view<User>()({ id: true, name: true });
  const client = createClient({
    roots: { node: clientRoot<User, 'Node'>('Node') },
    transport: {
      fetchById: vi.fn(async () => []),
      fetchQuery: async () => ({ __typename: 'User', id: '1', name: 'Ada' }),
    },
    types: [{ possibleTypes: ['User'], type: 'Node' }, { type: 'User' }],
  });
  const result = await client.request({ node: { view: UserView } });
  expect(client.store.read('User:1')).toMatchObject({ name: 'Ada' });
  expect(result.node).toMatchObject({ __typename: 'User', id: '1' });
});
