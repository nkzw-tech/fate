import { expect, test } from 'vite-plus/test';
import { createLiveEventBus } from '../live.ts';

test('live event bus yields update events', async () => {
  const live = createLiveEventBus();
  const iterator = live.subscribe('User', 'user-1')[Symbol.asyncIterator]();
  const next = iterator.next();

  live.update('User', 'user-1', { eventId: 'event-1' });

  await expect(next).resolves.toEqual({
    done: false,
    value: [
      {
        eventId: 'event-1',
        id: 'user-1',
        type: 'update',
      },
    ],
  });

  await iterator.return?.();
});

test('live event bus yields delete events', async () => {
  const live = createLiveEventBus();
  const iterator = live.subscribe('User', 'user-1')[Symbol.asyncIterator]();
  const next = iterator.next();

  live.delete('User', 'user-1', { eventId: 'event-2' });

  await expect(next).resolves.toEqual({
    done: false,
    value: [
      {
        eventId: 'event-2',
        id: 'user-1',
        type: 'delete',
      },
    ],
  });

  await iterator.return?.();
});

test('live event bus yields scoped and global connection events', async () => {
  const live = createLiveEventBus();
  const scopedSubscription = live.subscribeConnection({
    args: { categoryId: 'fruit' },
    procedure: 'posts',
  });
  const otherSubscription = live.subscribeConnection({
    args: { categoryId: 'vegetables' },
    procedure: 'posts',
  });
  const scopedIterator = scopedSubscription[Symbol.asyncIterator]();
  const otherIterator = otherSubscription[Symbol.asyncIterator]();

  const scopedNext = scopedIterator.next();
  live.connection('posts', { categoryId: 'fruit' }).appendNode('Post', 'post-1', {
    eventId: 'event-3',
  });

  await expect(scopedNext).resolves.toEqual({
    done: false,
    value: [
      {
        eventId: 'event-3',
        id: 'post-1',
        nodeType: 'Post',
        type: 'appendNode',
      },
    ],
  });

  const globalScopedNext = scopedIterator.next();
  const globalOtherNext = otherIterator.next();
  live.connection('posts').invalidate({ eventId: 'event-4' });

  await expect(globalScopedNext).resolves.toEqual({
    done: false,
    value: [{ eventId: 'event-4', type: 'invalidate' }],
  });
  await expect(globalOtherNext).resolves.toEqual({
    done: false,
    value: [{ eventId: 'event-4', type: 'invalidate' }],
  });

  await scopedIterator.return?.();
  await otherIterator.return?.();
});
