import { bench, describe } from 'vite-plus/test';
import { decodeHydrationValue, encodeHydrationValue } from '../hydration.ts';
import { createNodeRef } from '../node-ref.ts';
import { getListKey, Store, type StoreHydrationState } from '../store.ts';

const recordCount = 2000;
const listCount = 200;
const listSize = 50;

const state: StoreHydrationState = {
  coverage: Array.from({ length: recordCount }, (_, index) => [
    `Post:${index}`,
    ['author', 'id', 'metadata.category', 'metadata.rank', 'title'],
  ]),
  lists: Array.from({ length: listCount }, (_, listIndex) => [
    getListKey('Feed:root', 'posts', `page:${listIndex}`),
    {
      cursors: Array.from({ length: listSize }, (_, index) => `cursor:${listIndex}:${index}`),
      ids: Array.from({ length: listSize }, (_, index) => `Post:${listIndex * listSize + index}`),
      pagination: { hasNext: true, hasPrevious: listIndex > 0 },
    },
  ]),
  records: Array.from({ length: recordCount }, (_, index) => [
    `Post:${index}`,
    {
      author: createNodeRef(`User:${index % 100}`),
      id: String(index),
      metadata: { category: `category:${index % 10}`, rank: index },
      title: `Post ${index}`,
    },
  ]),
};

const encoded = encodeHydrationValue({ rootLists: [], rootRequests: [], store: state });

describe('Hydration large-cache operations', () => {
  bench('decode hydration payload', () => {
    decodeHydrationValue(encoded);
  });

  bench('replace hydrated store state and rebuild indexes', () => {
    new Store().hydrate(state, 'replace');
  });
});
