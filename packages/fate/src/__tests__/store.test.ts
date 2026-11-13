import { expect, test, vi } from 'vite-plus/test';
import ViewDataCache from '../cache.ts';
import { CoverageSelection } from '../mask.ts';
import { createNodeRef, getNodeRefId } from '../node-ref.ts';
import { getListKey, Store } from '../store.ts';

test('notifies field subscribers when their record is deleted', async () => {
  const store = new Store();
  store.merge('Post:1', { title: 'Current' }, ['title']);
  const listener = vi.fn();
  const dispose = store.subscribe('Post:1', new Set(['title']), () =>
    listener(store.read('Post:1')),
  );

  store.deleteRecord('Post:1');
  store.deleteRecord('Post:1');
  await Promise.resolve();

  expect(listener).toHaveBeenCalledOnce();
  expect(listener).toHaveBeenCalledWith(undefined);
  dispose();
});

test('shared coverage survives transaction rollback, preview and optimistic rebasing', () => {
  const store = new Store();
  const selection = new CoverageSelection(['id', 'profile.name']);
  for (const id of ['User:a', 'User:b']) {
    store.merge(id, { id, profile: { name: 'Before' } }, selection);
  }
  const change = () =>
    store.merge('User:a', { profile: { age: 42 } }, ['profile.age'], ['profile']);
  const check = () => {
    for (const id of ['User:a', 'User:b']) {
      expect(store.hasCoverage(id, 'profile.name')).toBe(true);
      expect(store.hasCoverage(id, 'profile.age')).toBe(false);
      expect(store.read(id)?.profile).toEqual({ name: 'Before' });
    }
  };
  expect(() =>
    store.transaction(() => {
      change();
      throw new Error('Rollback');
    }),
  ).toThrow('Rollback');
  check();
  store.preview(change, () => expect(store.hasCoverage('User:a', 'profile.age')).toBe(true));
  check();
  const settle = store.optimisticUpdate(change);
  expect(store.hasCoverage('User:b', 'profile.name')).toBe(true);
  expect(store.hasCoverage('User:b', 'profile.age')).toBe(false);
  settle();
  check();
});

test('preserves references as index memberships shrink, grow, roll back, and are collected', () => {
  const store = new Store();
  const cache = new ViewDataCache();
  store.merge(
    'Post:1',
    {
      author: createNodeRef('User:1'),
      reviewers: [createNodeRef('User:1'), createNodeRef('User:2'), createNodeRef('User:1')],
    },
    ['author', 'reviewers'],
  );
  store.merge('Post:1', { reviewers: [createNodeRef('User:1')] }, ['reviewers']);
  expect(store.getPersistenceOwners('User:2').records).toEqual([]);
  store.merge('Post:1', { author: null }, ['author']);
  expect(store.getPersistenceOwners('User:1').records).toEqual(['Post:1']);
  const settle = store.optimisticUpdate(() => {
    store.merge('Post:1', { author: createNodeRef('User:2') }, ['author']);
  });
  expect(store.getPersistenceOwners('User:2').records).toEqual(['Post:1']);
  settle();
  expect(store.getPersistenceOwners('User:2').records).toEqual([]);
  store.removeReferencesTo('User:1', cache);
  expect(store.read('Post:1')).toEqual({ author: null, reviewers: [] });
  expect(store.getPersistenceOwners('User:1').records).toEqual([]);

  const first = getListKey('User:1', 'posts', 'first');
  const second = getListKey('User:1', 'posts', 'second');
  store.setList(first, { ids: ['Post:1', 'Post:1'] });
  store.setList(second, { ids: ['Post:1'] });
  store.collectGarbage(new Set(['Post:1']), new Set([second]));
  expect(store.getListsForField('User:1', 'posts').map(([key]) => key)).toEqual([second]);
  expect(store.getPersistenceOwners('Post:1').lists).toEqual([second]);
  store.removeReferencesTo('Post:1', cache);
  expect(store.getListState(second)?.ids).toEqual([]);
  expect(store.getListKeysForEntity('Post:1')).toEqual([]);
});

test('isolates shared coverage when a record gains fields or replaces an embedded selection', () => {
  const store = new Store();
  const coverage = new CoverageSelection(['id', 'profile.name']);
  for (const id of ['User:1', 'User:2']) {
    store.merge(id, { id, profile: { name: id } }, coverage);
  }
  store.merge('User:1', { bio: 'Biography' }, ['bio']);
  expect(store.hasCoverage('User:1', 'bio')).toBe(true);
  expect(store.hasCoverage('User:2', 'bio')).toBe(false);
  store.merge('User:1', { profile: { color: 'blue' } }, ['profile.color'], ['profile']);
  expect(store.hasCoverage('User:1', 'profile.name')).toBe(false);
  expect(store.hasCoverage('User:1', 'profile.color')).toBe(true);
  expect(store.hasCoverage('User:2', 'profile.name')).toBe(true);
  const settle = store.optimisticUpdate(() =>
    store.merge('User:2', { name: 'Temporary' }, ['name']),
  );
  expect(store.hasCoverage('User:2', 'name')).toBe(true);
  settle();
  expect(store.hasCoverage('User:2', 'name')).toBe(false);
  store.merge('User:3', { id: '3' }, coverage);
  expect(store.hasCoverage('User:3', 'bio')).toBe(false);
  expect(store.hasCoverage('User:3', 'profile.name')).toBe(true);
});

test('updates list metadata and notifications while preserving unchanged membership indexes', () => {
  const onChange = vi.fn();
  const store = new Store(undefined, onChange);
  const key = getListKey('User:1', 'posts');
  store.setList(key, {
    ids: ['Post:1'],
    pagination: { hasNext: true, hasPrevious: false },
    pendingBeforeIds: ['Post:2'],
  });
  const listener = vi.fn();
  store.subscribeList(key, listener);
  const previousList = store.getListState(key);
  store.setList(key, {
    cursors: ['one'],
    ids: ['Post:1'],
    pagination: { hasNext: false, hasPrevious: false },
    pendingBeforeIds: ['Post:2'],
  });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(onChange.mock.lastCall?.[0]).toEqual({ key, kind: 'list', previousList });
  expect(store.getListState(key)?.pagination?.hasNext).toBe(false);
  expect(store.getListKeysForEntity('Post:1')).toContain(key);
  expect(store.getListKeysForEntity('Post:2')).toContain(key);
  store.setList(key, { ids: ['Post:1'], liveAfterIds: ['Post:3'] });
  expect(store.getListKeysForEntity('Post:2')).not.toContain(key);
  expect(store.getListKeysForEntity('Post:3')).toContain(key);
  store.removeReferencesTo('Post:3', new ViewDataCache());
  expect(store.getListState(key)?.liveAfterIds).toEqual([]);
});

test('keeps cursor alignment when removing ids with undefined cursors', () => {
  const store = new Store();
  const cache = new ViewDataCache();
  const listKey = 'list';

  store.setList(listKey, {
    cursors: ['cursor-one', undefined],
    ids: ['one', 'two'],
  });

  store.removeReferencesTo('one', cache);

  const list = store.getList(listKey);
  expect(list).toEqual(['two']);

  const state = list ? store.getListState(listKey) : undefined;
  expect(state?.cursors).toEqual([undefined]);
});

test('removes references from pending list edges', () => {
  const store = new Store();
  const cache = new ViewDataCache();
  const listKey = 'list';

  store.setList(listKey, {
    cursors: ['cursor-one', 'cursor-two', 'cursor-three'],
    ids: ['one', 'two', 'three'],
    pendingAfterIds: ['four', 'two', 'five'],
    pendingBeforeIds: ['zero', 'two'],
  });

  store.removeReferencesTo('two', cache);

  expect(store.getListState(listKey)).toEqual({
    cursors: ['cursor-one', 'cursor-three'],
    ids: ['one', 'three'],
    pendingAfterIds: ['four', 'five'],
    pendingBeforeIds: ['zero'],
  });
});

test('does not update records or notify subscribers for shallow equal merges', () => {
  const store = new Store();
  const entityId = 'Post:1';

  store.merge(
    entityId,
    {
      __typename: 'Post',
      id: 'post-1',
      title: 'Apple',
    },
    new Set(['__typename', 'id', 'title']),
  );

  const initialRecord = store.read(entityId);
  const subscriber = vi.fn();
  store.subscribe(entityId, subscriber);

  store.merge(entityId, {}, new Set());

  expect(store.read(entityId)).toBe(initialRecord);
  expect(subscriber).not.toHaveBeenCalled();

  store.merge(
    entityId,
    {
      title: 'Apple',
    },
    new Set(['title']),
  );

  expect(store.read(entityId)).toBe(initialRecord);
  expect(subscriber).not.toHaveBeenCalled();

  store.merge(
    entityId,
    {
      title: 'Banana',
    },
    new Set(['title']),
  );

  expect(store.read(entityId)).not.toBe(initialRecord);
  expect(subscriber).toHaveBeenCalled();
});

test('only notifies subscribers with intersecting selections', () => {
  const store = new Store();
  const entityId = 'Post:1';

  store.merge(
    entityId,
    {
      __typename: 'Post',
      id: 'post-1',
      likes: 1,
      title: 'Initial',
    },
    new Set(['__typename', 'id', 'likes', 'title']),
  );

  const likesSubscriber = vi.fn();
  const titleSubscriber = vi.fn();
  const catchAllSubscriber = vi.fn();

  store.subscribe(entityId, new Set(['likes']), likesSubscriber);
  store.subscribe(entityId, new Set(['title']), titleSubscriber);
  store.subscribe(entityId, catchAllSubscriber);

  store.merge(entityId, { likes: 2 }, new Set(['likes']));

  expect(likesSubscriber).toHaveBeenCalledTimes(1);
  expect(titleSubscriber).not.toHaveBeenCalled();
  expect(catchAllSubscriber).toHaveBeenCalledTimes(1);

  store.merge(entityId, { title: 'Updated' }, new Set(['title']));

  expect(likesSubscriber).toHaveBeenCalledTimes(1);
  expect(titleSubscriber).toHaveBeenCalledTimes(1);
  expect(catchAllSubscriber).toHaveBeenCalledTimes(2);
});

test('updates coverage when merging identical values', () => {
  const store = new Store();
  const entityId = 'Post:1';

  store.merge(
    entityId,
    {
      __typename: 'Post',
      id: 'post-1',
      subtitle: 'Sub',
      title: 'Title',
    },
    new Set(['__typename', 'id', 'title']),
  );

  expect(store.missingForSelection(entityId, new Set(['title', 'subtitle']))).toEqual(
    new Set(['subtitle']),
  );

  store.merge(entityId, { subtitle: 'Sub' }, new Set(['subtitle']));

  expect(store.missingForSelection(entityId, new Set(['title', 'subtitle']))).toEqual(new Set());
});

test('rebasing reports coverage changes only to the affected selection', () => {
  const store = new Store();
  store.merge('Post:1', { id: '1', subtitle: 'Sub', title: 'Initial' }, ['id', 'title']);
  const settle = store.optimisticUpdate(() =>
    store.merge('Post:1', { title: 'Pending' }, ['title']),
  );
  const titleChanged = vi.fn();
  const subtitleChanged = vi.fn();
  store.subscribe('Post:1', new Set(['title']), titleChanged);
  store.subscribe('Post:1', new Set(['subtitle']), subtitleChanged);
  store.merge('Post:1', { subtitle: 'Sub' }, ['subtitle']);
  expect(subtitleChanged).toHaveBeenCalledTimes(1);
  expect(titleChanged).not.toHaveBeenCalled();
  settle();
  expect(titleChanged).toHaveBeenCalledTimes(1);
  expect(subtitleChanged).toHaveBeenCalledTimes(1);
});

test('keeps indexed list lookup in sync with list writes and deletes', () => {
  const store = new Store();
  const defaultKey = getListKey('Post:1', 'comments');
  const filteredKey = getListKey('Post:1', 'comments', 'filter:a');

  store.setList(defaultKey, { ids: ['Comment:1'] });
  store.setList(filteredKey, { ids: ['Comment:2'], pendingAfterIds: ['Comment:3'] });
  store.setList(getListKey('Post:2', 'comments'), { ids: ['Comment:4'] });

  expect(
    store
      .getListsForField('Post:1', 'comments')
      .map(([key]) => key)
      .sort(),
  ).toEqual([defaultKey, filteredKey]);

  store.restoreList(defaultKey, undefined);

  expect(store.getListsForField('Post:1', 'comments').map(([key]) => key)).toEqual([filteredKey]);
});

test('indexes list keys when owner ids contain the internal separator', () => {
  const store = new Store();
  const ownerId = 'Post:post __fate__ 1';
  const key = getListKey(ownerId, 'comments', 'object:{"q":string:"a __fate__ b"}');

  store.setList(key, { ids: ['Comment:1'] });

  expect(store.getListsForField(ownerId, 'comments').map(([listKey]) => listKey)).toEqual([key]);
  expect(store.getListsForField('Post:post', '1')).toEqual([]);

  store.restoreList(key, undefined);

  expect(store.getListsForField(ownerId, 'comments')).toEqual([]);
});

test('removes references using updated record reference indexes', () => {
  const store = new Store();
  const cache = new ViewDataCache();
  const postId = 'Post:1';

  store.merge(
    postId,
    {
      author: createNodeRef('User:1'),
      tags: [createNodeRef('Tag:1'), createNodeRef('Tag:2')],
    },
    new Set(['author', 'tags']),
  );

  store.merge(postId, { author: createNodeRef('User:2') }, new Set(['author']));

  store.removeReferencesTo('User:1', cache);
  expect(getNodeRefId(store.read(postId)?.author as ReturnType<typeof createNodeRef>)).toBe(
    'User:2',
  );

  store.removeReferencesTo('User:2', cache);
  expect(store.read(postId)?.author).toBeNull();

  store.removeReferencesTo('Tag:1', cache);
  const tags = store.read(postId)?.tags as Array<ReturnType<typeof createNodeRef>>;
  expect(tags.map(getNodeRefId)).toEqual(['Tag:2']);
});

test('consumes coverage iterables before extending the existing field mask', () => {
  const store = new Store();
  store.merge('Post:coverage', { id: 'coverage' }, ['profile.name']);
  function* paths() {
    yield 'profile';
    expect(store.missingForSelection('Post:coverage', ['profile.age'])).toEqual(
      new Set(['profile.age']),
    );
    yield 'extra';
  }
  store.merge('Post:coverage', {}, paths());
  expect(store.missingForSelection('Post:coverage', ['profile.age', 'extra'])).toEqual(new Set());
});

test('transactions roll back records, coverage, invalidation and optimistic settlement', () => {
  const changes = vi.fn();
  const store = new Store(undefined, changes);
  store.merge('Post:1', { id: '1', title: 'Base' }, ['id', 'title']);
  const settle = store.optimisticUpdate(() =>
    store.merge('Post:1', { title: 'Pending' }, ['title']),
  );
  changes.mockClear();
  const notify = vi.fn();
  store.subscribe('Post:1', notify);
  expect(() =>
    store.transaction(() => {
      settle(() => store.merge('Post:1', { title: 'Committed' }, ['title']));
      store.invalidateRecord('Post:1');
      store.merge('Post:2', { id: '2' }, ['id']);
      throw new Error('normalization failed');
    }),
  ).toThrow('normalization failed');
  expect(store.read('Post:1')?.title).toBe('Pending');
  expect(store.read('Post:2')).toBeUndefined();
  expect(store.hasStaleRecord('Post:1')).toBe(false);
  expect(notify).not.toHaveBeenCalled();
  expect(changes).not.toHaveBeenCalled();
  settle();
  expect(store.read('Post:1')?.title).toBe('Base');
});

test('batches nested record and list notifications after publishing cache changes', () => {
  const changed = vi.fn();
  const store = new Store(undefined, changed);
  const snapshots: Array<unknown> = [];
  const notify = () => snapshots.push([store.read('Item:1'), store.getList('items')]);
  store.subscribe('Item:1', notify);
  store.subscribeList('items', notify);
  store.update(() => {
    store.merge('Item:1', { title: 'First' }, ['title']);
    store.transaction(() => store.merge('Item:1', { title: 'Last' }, ['title']));
    store.setList('items', { ids: ['Item:1'] });
    expect(changed).toHaveBeenCalled();
    expect(snapshots).toEqual([]);
  });
  expect(snapshots).toEqual([[{ title: 'Last' }, ['Item:1']]]);
});

test('failed batches publish partial writes and release notification state', () => {
  const store = new Store();
  const notify = vi.fn(() => store.read('Item:1')?.title);
  store.subscribe('Item:1', notify);
  expect(() =>
    store.update(() => {
      store.merge('Item:1', { title: 'Committed' }, ['title']);
      throw new Error('Failed');
    }),
  ).toThrow('Failed');
  expect(notify).toHaveReturnedWith('Committed');
  store.update(() => store.merge('Item:1', { title: 'Next' }, ['title']));
  expect(notify).toHaveBeenCalledTimes(2);
  expect(notify).toHaveLastReturnedWith('Next');
});

test('a rolled-back transaction inside a batch does not publish its notifications', () => {
  const store = new Store();
  const notify = vi.fn();
  store.subscribe('Item:1', notify);
  store.update(() => {
    expect(() =>
      store.transaction(() => {
        store.merge('Item:1', { title: 'Rolled back' }, ['title']);
        throw new Error('Rollback');
      }),
    ).toThrow('Rollback');
  });
  expect(notify).not.toHaveBeenCalled();
  expect(store.read('Item:1')).toBeUndefined();
});
