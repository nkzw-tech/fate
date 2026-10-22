import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createClient } from '../../client.ts';
import { defer } from '../../defer.ts';
import { mutation } from '../../mutation.ts';
import { clientRoot } from '../../root.ts';
import type { Transport } from '../../transport.ts';
import type { Deferred, MutationMapFromDefinitions, SelectionOf, ViewRef } from '../../types.ts';
import { view } from '../../view.ts';

const collect = globalThis.gc;
assert.ok(collect);
const kind = process.argv[2];
type User = { __typename: 'User'; id: string; name: string; tasks: Array<User> };
const Name = view<User>()({ name: true });
const Details = view<User>()({ ...Name, id: true, tasks: defer({ items: { node: Name } }) });
const saved = { id: 'real', name: 'Saved', tasks: [] };
const response = Promise.withResolvers<typeof saved>();
const fetched: Array<ReadonlyArray<string | number>> = [];
const mutations = { create: mutation<User, object, typeof saved>('User') };
const roots = { user: clientRoot<User, 'User'>('User') };
const client = createClient<[typeof roots, typeof mutations]>({
  gcReleaseBufferSize: 0,
  mutations,
  roots,
  transport: {
    fetchById: async (_type, ids) => {
      fetched.push([...ids]);
      return [saved];
    },
    mutate: (() => response.promise) as Transport<
      MutationMapFromDefinitions<typeof mutations>
    >['mutate'],
  },
  types: [{ fields: { tasks: { listOf: 'User' } }, type: 'User' }],
});
const redirects = (client as unknown as { optimisticEntityResolutions: Map<string, unknown> })
  .optimisticEntityResolutions;
const populate = async () => {
  const pending = client.mutations.create({
    input: {},
    optimistic: { id: 'temporary', name: 'Pending' },
  });
  let handle: ViewRef<'User'> | Deferred<unknown>;
  if (kind === 'view') {
    handle = client.ref('User', 'temporary', Name);
  } else if (kind === 'cache-only') {
    const observer = client.observeRequest(
      { user: { id: 'temporary', view: Name } },
      { mode: 'cache-only' },
    );
    const ref = observer.getSnapshot().data?.user;
    assert.ok(ref);
    handle = ref;
  } else {
    const { data } = await client.readView<User, SelectionOf<typeof Details>, typeof Details>(
      Details,
      client.ref('User', 'temporary', Details),
    );
    handle = kind === 'deferred' ? data.tasks : data;
  }
  response.resolve(saved);
  await pending;
  return handle;
};
let handle: ViewRef<'User'> | Deferred<unknown> | undefined = await populate();
client.gc();
for (let index = 0; index < 3; index++) {
  await setImmediate();
  collect();
}
client.gc();
assert.equal(client.store.dehydrate().records.length, 0);
assert.ok(redirects.size > 0, 'A held ref lost its optimistic redirect');

const read = async () => {
  if (kind === 'deferred') {
    await client.readDeferred(handle as Deferred<unknown>);
    const insertion = client.resolveMutationInsertion('User', {
      into: handle as Deferred<Array<User>>,
      position: 'after',
    });
    assert.ok(typeof insertion !== 'string');
    assert.equal(insertion[0].list.owner, 'User:real');
  } else {
    const { data } = await client.readView<User, SelectionOf<typeof Name>, typeof Name>(
      Name,
      handle as ViewRef<'User'>,
    );
    assert.equal(data.name, 'Saved');
  }
};
await read();
assert.deepEqual(fetched, [['real']], 'A held optimistic ref fetched its obsolete temporary ID');
handle = undefined;
client.gc();
for (let index = 0; index < 3; index++) {
  await setImmediate();
  collect();
}
client.gc();
assert.equal(redirects.size, 0, 'Released refs left a permanent optimistic redirect');
