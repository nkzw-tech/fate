import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createClient } from '../../client.ts';
import { clientRoot } from '../../root.ts';
import { view } from '../../view.ts';

const collect = globalThis.gc;
assert.ok(collect);
type User = { __typename: 'User'; id: string; name: string };
const Identity = view<User>()({ id: true });
const Name = view<User>()(({ locale }: { locale: string }) => ({ name: { args: { locale } } }));
const client = createClient({
  gcReleaseBufferSize: 0,
  roots: { user: clientRoot<User, 'User'>('User') },
  types: [{ type: 'User' }],
});
const request = { user: { id: '1', view: Identity } };
const retained = client.retain(request);
client.write('User', { id: '1' }, new Set(['id']));
const ref = client.ref('User', '1', Identity);
const released = new WeakRef(client.ref('User', '1', Name({ locale: 'ja' })));
client.gc();
for (let index = 0; index < 3; index++) {
  await setImmediate();
  collect();
}
assert.equal(released.deref(), undefined, 'The retained entity still owns a released view ref');
assert.equal(client.ref('User', '1', Identity), ref);
retained.dispose();
