import { expect, test, vi } from 'vite-plus/test';
import ViewDataCache from '../cache.ts';
import { createNodeRef, getNodeRefId } from '../node-ref.ts';
import { getListKey, Store } from '../store.ts';

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
