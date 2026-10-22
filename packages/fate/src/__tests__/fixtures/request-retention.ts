import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createClient } from '../../client.ts';
import { clientRoot } from '../../root.ts';
import { view } from '../../view.ts';

const collect = globalThis.gc;
assert.ok(collect);
type User = { __typename: 'User'; id: string; name: string };
const Name = view<User>()({ name: true });
const client = createClient({
  gcReleaseBufferSize: 0,
  roots: { users: clientRoot<Array<User>, 'User'>('User') },
  transport: {
    fetchById: async () => [],
    fetchList: async () => ({
      items: [{ cursor: undefined, node: { id: '1', name: 'Ada' } }],
      pagination: { hasNext: false, hasPrevious: false },
    }),
  },
  types: [{ type: 'User' }],
});
const populate = async () => {
  const request = { users: { list: { items: { node: Name } } } };
  const retained = client.retain(request);
  await client.request(request);
  const state = client.store.getListState('users');
  assert.ok(state);
  const watched = new WeakRef(state);
  retained.dispose();
  return watched;
};
const watched = await populate();
client.gc();
for (let index = 0; index < 3; index++) {
  await setImmediate();
  collect();
}
assert.equal(client.store.getListState('users'), undefined);
assert.equal(
  watched.deref(),
  undefined,
  'A completed request still retains its collected list state',
);
