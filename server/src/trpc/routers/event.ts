import { z } from 'zod';
import { EventFindManyArgs } from '../../prisma/prisma-client/models.ts';
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
  id: true,
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
        select,
        where: { id: { in: input.ids } },
      } as EventFindManyArgs);

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
        edges: limited.map((node) => ({ cursor: node.id, node })),
        pageInfo: {
          endCursor: limited.length ? limited.at(-1)!.id : undefined,
          hasNextPage: hasNext,
        },
      };
    }),
});
