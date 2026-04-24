import { initTRPC } from '@trpc/server';
import { expect, test } from 'vite-plus/test';
import { dataView } from '../dataView.ts';
import { createSourceRegistry } from '../executor.ts';
import { createLiveEventBus } from '../live.ts';
import { createSourceProcedures } from '../sourceRouter.ts';

type User = {
  id: string;
  name: string;
};

test('live source procedures refetch selected records from bus events', async () => {
  const userView = dataView<User>('User')({
    id: true,
    name: true,
  });
  const source = {
    id: 'id',
    view: userView,
  };
  const records = new Map<string, User>([['user-1', { id: 'user-1', name: 'Apple' }]]);
  const registry = createSourceRegistry([
    [
      source,
      {
        byId: async ({ id }) => records.get(id) ?? null,
      },
    ],
  ]);
  const live = createLiveEventBus();
  const t = initTRPC.context<Record<string, never>>().create();
  const procedures = createSourceProcedures({
    byId: false,
    list: false,
    live: { bus: live },
    procedure: t.procedure,
    registry,
    source,
  });
  const appRouter = t.router({
    user: t.router(procedures),
  });
  const caller = appRouter.createCaller({});
  const iterable = await caller.user.live({
    id: 'user-1',
    select: ['id', 'name'],
  });
  const iterator = (iterable as unknown as AsyncIterable<unknown>)[Symbol.asyncIterator]();
  const next = iterator.next();

  records.set('user-1', { id: 'user-1', name: 'Banana' });
  live.update('User', 'user-1');

  await expect(next).resolves.toEqual({
    done: false,
    value: {
      data: {
        id: 'user-1',
        name: 'Banana',
      },
    },
  });
  await iterator.return?.();
});

test('live source procedures yield delete events', async () => {
  const userView = dataView<User>('User')({
    id: true,
    name: true,
  });
  const source = {
    id: 'id',
    view: userView,
  };
  const registry = createSourceRegistry([
    [
      source,
      {
        byId: async () => null,
      },
    ],
  ]);
  const live = createLiveEventBus();
  const t = initTRPC.context<Record<string, never>>().create();
  const procedures = createSourceProcedures({
    byId: false,
    list: false,
    live,
    procedure: t.procedure,
    registry,
    source,
  });
  const appRouter = t.router({
    user: t.router(procedures),
  });
  const caller = appRouter.createCaller({});
  const iterable = await caller.user.live({
    id: 'user-1',
    select: ['id'],
  });
  const iterator = (iterable as unknown as AsyncIterable<unknown>)[Symbol.asyncIterator]();
  const next = iterator.next();

  live.delete('User', 'user-1');

  await expect(next).resolves.toEqual({
    done: false,
    value: {
      delete: true,
      id: 'user-1',
    },
  });
  await iterator.return?.();
});
