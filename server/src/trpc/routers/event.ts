import { z } from 'zod';
import { prismaSelect } from '../../prisma/prismaSelect.tsx';
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
  list: procedure
    .input(
      z.object({
        after: z.string().optional(),
        first: z.number().int().positive().optional(),
        select: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const take = (input.first ?? 3) + 1;
      const select = prismaSelect(input?.select);

      delete select?.attendingCount;

      const events = await ctx.prisma.event.findMany({
        orderBy: { startAt: 'asc' },
        select: { ...select, ...eventSelect },
        take,
      });

      const rows = events.map(({ _count, ...event }) => ({
        ...event,
        attendingCount: _count.attendees,
      }));

      const hasNext = rows.length > (input.first ?? 20);
      const limited = rows.slice(0, input.first ?? 20);
      return {
        items: limited.map((node) => ({ cursor: node.id, node })),
        pagination: {
          hasNext,
          hasPrevious: Boolean(input.after),
          nextCursor: limited.length ? limited.at(-1)!.id : undefined,
          previousCursor: input.after,
        },
      };
    }),
});
