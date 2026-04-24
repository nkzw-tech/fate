import { computed, count, createSourcePlan, dataView, list } from '@nkzw/fate/server';
import { createPrismaSourceAdapter } from '@nkzw/fate/server/prisma';
import { expect, test, vi } from 'vite-plus/test';
import type { AppContext } from '../context.ts';

test('hydrates conflicting filtered counts for the same Prisma relation', async () => {
  const attendeeView = dataView<{ eventId: string; id: string }>('EventAttendee')({
    id: true,
  });
  const eventView = dataView<{ attendees?: Array<{ eventId: string; id: string }>; id: string }>(
    'Event',
  )({
    attendees: list(attendeeView),
    goingCount: computed<{ id: string }, number>({
      resolve: (_item, deps) => (deps.count as number) ?? 0,
      select: {
        count: count('attendees', {
          where: { status: 'GOING' },
        }),
      },
    }),
    id: true,
    waitlistCount: computed<{ id: string }, number>({
      resolve: (_item, deps) => (deps.count as number) ?? 0,
      select: {
        count: count('attendees', {
          where: { status: 'WAITLIST' },
        }),
      },
    }),
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
  const adapter = createPrismaSourceAdapter<AppContext>({
    views: [
      {
        delegate: () => ({
          findMany: async () => [{ id: 'event-1' }, { id: 'event-2' }],
        }),
        view: eventView,
      },
      {
        delegate: () => ({ groupBy }),
        view: attendeeView,
      },
    ],
  });
  const plan = createSourcePlan({
    ctx,
    select: ['goingCount', 'waitlistCount'],
    source: adapter.getSource(eventView),
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
