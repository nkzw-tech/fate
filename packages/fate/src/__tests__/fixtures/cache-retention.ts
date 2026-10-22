import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import ViewDataCache from '../../cache.ts';
import { createRefWithViewNames } from '../../ref.ts';
import { ViewsTag, type View, type ViewRef, type ViewSnapshot } from '../../types.ts';

const collect = globalThis.gc;
assert.ok(collect, 'Run the retention fixture with --expose-gc');

const scenario = process.argv[2];
const cache = new ViewDataCache();
const selected = {} as View<any, any>;
const ref = createRefWithViewNames('User', '1', new Set());
const parentRef = createRefWithViewNames('User', '2', new Set());
const unchangedRef = createRefWithViewNames('User', '4', new Set());

const addSnapshot = (
  id: string,
  ref: ViewRef<'User'>,
  coverage: ViewSnapshot<any, any>['coverage'],
) => {
  const snapshot: ViewSnapshot<any, any> = {
    coverage,
    data: { name: 'Sam', [ViewsTag]: new Set() },
  };
  const thenable = Object.assign(Promise.resolve(snapshot), {
    status: 'fulfilled' as const,
    value: snapshot,
  });
  cache.set(id, selected, ref, thenable);
  return new WeakRef(snapshot);
};

const watched = addSnapshot(
  'User:1',
  ref,
  scenario === 'unknown-fields'
    ? []
    : [
        ['User:1', new Set(['name'])],
        ['User:3', new Set(['name'])],
      ],
);
const unchanged = addSnapshot('User:4', unchangedRef, [['User:4', new Set(['name'])]]);
let parent: WeakRef<ViewSnapshot<any, any>> | undefined;

switch (scenario) {
  case 'selected-field':
    cache.invalidate('User:1', ['name']);
    break;
  case 'unknown-fields':
    cache.invalidate('User:1', ['extra']);
    break;
  case 'deleted-dependency':
    cache.invalidate('User:3');
    break;
  case 'invalidated-views':
    // Leave this parent unread so its dependency metadata keeps the invalidated
    // entity cache alive. That metadata must not retain the entity's views.
    parent = addSnapshot('User:2', parentRef, [
      ['User:1', new Set(['name'])],
      ['User:2', new Set(['name'])],
    ]);
    cache.invalidate('User:1');
    break;
  default:
    throw new Error(`Unknown retention scenario: ${scenario}`);
}

if (scenario !== 'invalidated-views') {
  // A cache miss must release the old snapshot without needing a replacement.
  assert.equal(cache.get('User:1', selected, ref), null);
}

// WeakRef targets stay alive until the creating job finishes. Collect in later
// turns without dereferencing them, which would extend their lifetimes again.
for (let index = 0; index < 3; index++) {
  await setImmediate();
  collect();
}
assert.equal(watched.deref(), undefined, 'The invalid snapshot is still retained');
assert.ok(unchanged.deref(), 'An unchanged snapshot should remain cached');
assert.equal(cache.get('User:4', selected, unchangedRef)?.value, unchanged.deref());

if (parent) {
  assert.ok(parent.deref(), 'The unread parent should still hold dependency metadata');
  assert.equal(cache.get('User:2', selected, parentRef), null);
}
