import { expect, test, vi } from 'vite-plus/test';
import type { AnyRecord } from '../../types.ts';
import { dataView, list, type DataView } from '../dataView.ts';
import { createSourceRegistry } from '../executor.ts';
import { createFateServer } from '../http.ts';
import { createLiveEventBus } from '../live.ts';
import type { SourceDefinition } from '../source.ts';

const setup = async (iterable: boolean, connection: boolean, finite = false) => {
  const postView = dataView<{ id: string; title: string }>('Post')({ id: true, title: true });
  const source: SourceDefinition = { id: 'id', view: postView };
  const bus = createLiveEventBus();
  const byIds = vi.fn(async () => [{ id: '1', title: 'Post' }]);
  const fate = createFateServer({
    live: {
      bus: iterable
        ? {
            ...bus,
            listen: undefined,
            listenConnection: undefined,
            ...(finite
              ? {
                  async *subscribe() {
                    for (let index = 1; index <= 2; index++) {
                      yield [
                        { eventId: `event-${index}`, id: '1', type: 'update' as const },
                      ] as const;
                    }
                  },
                  async *subscribeConnection() {
                    for (let index = 1; index <= 2; index++) {
                      yield [
                        {
                          eventId: `event-${index}`,
                          id: '1',
                          nodeType: 'Post',
                          type: 'appendNode' as const,
                        },
                      ] as const;
                    }
                  },
                }
              : undefined),
          }
        : bus,
      maxQueueSize: 2,
    },
    roots: { posts: list(postView) },
    sources: {
      getSource: <Item extends AnyRecord>(_target: DataView<Item> | SourceDefinition<Item>) =>
        source as unknown as SourceDefinition<Item>,
      registry: createSourceRegistry([[source, { byIds }]]),
    },
  });
  const response = await fate.handleLiveRequest(
    new Request('http://local/fate/live?connectionId=pressure'),
  );
  const reader = response.body!.getReader();
  await reader.read();
  const control = (operations: Array<object>) =>
    fate.handleLiveRequest(
      new Request('http://local/fate/live', {
        body: JSON.stringify({ connectionId: 'pressure', operations, version: 1 }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    );
  await control([
    {
      id: 'subscription',
      select: ['id', 'title'],
      type: 'Post',
      ...(connection
        ? { kind: 'subscribeConnection', procedure: 'posts' }
        : { entityId: '1', kind: 'subscribe' }),
    },
  ]);
  const emit = (index: number) => {
    if (connection) {
      bus.connection('posts').appendNode('Post', '1', { eventId: `event-${index}` });
    } else {
      bus.update('Post', '1', { eventId: `event-${index}` });
    }
  };
  return { byIds, control, emit, reader };
};

for (const iterable of [false, true]) {
  for (const connection of [false, true]) {
    const name = `${iterable ? 'iterable' : 'listener'} ${connection ? 'connection' : 'entity'}`;
    test(`${name} subscriptions pause resolution until the stream reader resumes`, async () => {
      vi.useFakeTimers();
      const { byIds, emit, reader } = await setup(iterable, connection);
      try {
        emit(1);
        await vi.advanceTimersByTimeAsync(0);
        expect(byIds).toHaveBeenCalledTimes(1);
        emit(2);
        await vi.advanceTimersByTimeAsync(0);
        expect(byIds).toHaveBeenCalledTimes(1);
        expect(new TextDecoder().decode((await reader.read()).value)).toContain('event-1');
        expect(new TextDecoder().decode((await reader.read()).value)).toContain('event-2');
        expect(byIds).toHaveBeenCalledTimes(2);
      } finally {
        await reader.cancel();
        vi.useRealTimers();
      }
    });

    test(`${name} subscriptions close when a slow reader exhausts the queue limit`, async () => {
      vi.useFakeTimers();
      const { byIds, control, emit, reader } = await setup(iterable, connection);
      try {
        for (let index = 1; index <= 4; index++) {
          emit(index);
          await vi.advanceTimersByTimeAsync(0);
        }
        expect(byIds).toHaveBeenCalledTimes(1);
        expect((await control([])).status).toBe(404);
        expect(new TextDecoder().decode((await reader.read()).value)).toContain('event-1');
        expect((await reader.read()).done).toBe(true);
      } finally {
        await reader.cancel();
        vi.useRealTimers();
      }
    });
  }
}

for (const connection of [false, true]) {
  test(`finite ${connection ? 'connection' : 'entity'} iterators deliver queued events before releasing their subscription`, async () => {
    vi.useFakeTimers();
    const { byIds, reader } = await setup(true, connection, true);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(byIds).toHaveBeenCalledTimes(1);
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('event-1');
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('event-2');
      expect(byIds).toHaveBeenCalledTimes(2);
    } finally {
      await reader.cancel();
      vi.useRealTimers();
    }
  });
}

test('heartbeats do not accumulate behind a blocked stream reader', async () => {
  vi.useFakeTimers();
  const { emit, reader } = await setup(false, false);
  try {
    emit(1);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('event-1');
    emit(2);
    const next = reader.read();
    await vi.advanceTimersByTimeAsync(0);
    expect(new TextDecoder().decode((await next).value)).toContain('event-2');
  } finally {
    await reader.cancel();
    vi.useRealTimers();
  }
});
