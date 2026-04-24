import { computed, count, createSourcePlan, dataView, defineSource } from '@nkzw/fate/server';
import { createPrismaSourceAdapter } from '@nkzw/fate/server/prisma';
import { expect, test, vi } from 'vite-plus/test';
import type { AppContext } from '../context.ts';

test('hydrates conflicting filtered counts for the same Prisma relation', async () => {
  const attendeeView = dataView<{ eventId: string; id: string }>('EventAttendee')({
    id: true,
  });
  const attendeeSource = defineSource(attendeeView, {
    id: 'id',
  });
  const eventView = dataView<{ id: string }>('Event')({
    goingCount: computed<{ id: string }, number>({
      needs: {
        count: count('attendees', {
          where: { status: 'GOING' },
        }),
      },
      resolve: (_item, deps) => (deps.count as number) ?? 0,
    }),
    id: true,
    waitlistCount: computed<{ id: string }, number>({
      needs: {
        count: count('attendees', {
          where: { status: 'WAITLIST' },
        }),
      },
      resolve: (_item, deps) => (deps.count as number) ?? 0,
    }),
  });
  const eventSource = defineSource(eventView, {
    id: 'id',
    relations: {
      attendees: {
        foreignKey: 'eventId',
        kind: 'many',
        localKey: 'id',
        source: () => attendeeSource,
      },
    },
  });
  const groupBy = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    if (where.status === 'GOING') {
      return [{ _count: { _all: 3 }, eventId: 'event-1' }];
    }

    return [
      { _count: { _all: 1 }, eventId: 'event-1' },
      { _count: { _all: 2 }, eventId: 'event-2' },
    ];
  });
  const ctx = {
    headers: {},
    prisma: {
      event: {},
      eventAttendee: { groupBy },
    },
    sessionUser: null,
  } as unknown as AppContext;
  const plan = createSourcePlan({
    ctx,
    select: ['goingCount', 'waitlistCount'],
    source: eventSource,
  });
  const adapter = createPrismaSourceAdapter<AppContext>({
    sources: [
      {
        delegate: () => ({
          findMany: async () => [{ id: 'event-1' }, { id: 'event-2' }],
        }),
        source: eventSource,
      },
      {
        delegate: () => ({ groupBy }),
        source: attendeeSource,
      },
    ],
  });
  const items = await adapter.fetchByIds({
    ctx,
    ids: ['event-1', 'event-2'],
    plan,
  });

  expect(groupBy).toHaveBeenCalledTimes(2);
  expect(await plan.resolveMany(items)).toEqual([
    { goingCount: 3, id: 'event-1', waitlistCount: 1 },
    { goingCount: 0, id: 'event-2', waitlistCount: 2 },
  ]);
});
