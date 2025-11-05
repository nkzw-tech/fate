import { z } from 'zod';
import { createConnectionProcedure } from '../../fate-server/connection.ts';
import { prismaSelect } from '../../fate-server/prismaSelect.tsx';
import { Event } from '../../prisma/prisma-client/client.ts';
import { procedure, router } from '../init.ts';

const eventSelect = {
  _count: {
    select: {
      attendees: {
        where: { status: 'GOING' },
      },
    },
  },
  attendees: {
    select: {
      id: true,
      notes: true,
      status: true,
      user: { select: { id: true } },
    },
  },
  capacity: true,
  description: true,
  endAt: true,
  id: true,
  livestreamUrl: true,
  location: true,
  name: true,
  resources: true,
  startAt: true,
  topics: true,
  type: true,
} as const;

export const eventRouter = router({
  byId: procedure
    .input(
      z.object({
        ids: z.array(z.string().min(1)).nonempty(),
        select: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const select = prismaSelect(input.select);
      const events = await ctx.prisma.event.findMany({
        select: { ...select, ...eventSelect },
        where: { id: { in: input.ids } },
      });

      const map = new Map(events.map((category) => [category.id, category]));
      return input.ids.map((id) => map.get(id)).filter(Boolean);
    }),
  list: createConnectionProcedure({
    defaultSize: 3,
    map: ({ rows }) =>
      (rows as Array<Event & { _count: { attendees: number } }>).map(
        ({ _count, ...event }) => ({
          ...event,
          attendingCount: _count.attendees,
        }),
      ),
    query: async ({ ctx, cursor, input, skip, take }) => {
      const select = prismaSelect(input?.select);
      delete select?.attendingCount;

      return ctx.prisma.event.findMany({
        orderBy: { startAt: 'asc' },
        select: { ...select, ...eventSelect },
        take,
        ...(cursor
          ? ({
              cursor: { id: cursor },
              skip,
            } as const)
          : null),
      });
    },
  }),
});
