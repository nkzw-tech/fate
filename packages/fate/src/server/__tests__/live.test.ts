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
