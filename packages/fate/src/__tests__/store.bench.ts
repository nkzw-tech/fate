import { bench, describe } from 'vite-plus/test';
import ViewDataCache from '../cache.ts';
import { createNodeRef } from '../node-ref.ts';
import { getListKey, Store } from '../store.ts';

const listCount = 2000;
const listSize = 50;
const recordCount = 2000;
const targetId = 'Comment:target';

const createIndexedListStore = () => {
  const store = new Store();
  const ownerId = 'Post:large-owner';

  for (let listIndex = 0; listIndex < listCount; listIndex += 1) {
    const ids = Array.from({ length: listSize }, (_, index) => `Comment:${listIndex}:${index}`);

    store.setList(getListKey(ownerId, 'comments', `filter:${listIndex}`), {
      ids,
      pendingAfterIds: listIndex % 10 === 0 ? [targetId] : undefined,
    });
  }

  return { ownerId, store };
};

const createReferenceStore = () => {
  const store = new Store();

  for (let index = 0; index < recordCount; index += 1) {
    const id = `Post:${index}`;
    store.merge(
      id,
      {
        author: createNodeRef(index % 100 === 0 ? targetId : `User:${index}`),
        comments:
          index % 50 === 0
            ? [createNodeRef(`Comment:${index}`), createNodeRef(targetId)]
            : [createNodeRef(`Comment:${index}`)],
        id,
      },
      new Set(['author', 'comments', 'id']),
    );
  }

  return store;
};

describe('Store indexed large-collection operations', () => {
  const { ownerId, store } = createIndexedListStore();

  bench('getListsForField with many lists on one owner field', () => {
    store.getListsForField(ownerId, 'comments');
  });

  bench('removeReferencesTo with many records and lists', () => {
    createReferenceStore().removeReferencesTo(targetId, new ViewDataCache());
  });
});
