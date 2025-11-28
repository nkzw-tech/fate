import {
  arrayToConnection,
  connectionArgs,
  createResolver,
  getScopedArgs,
} from '@nkzw/fate/server';
import { z } from 'zod';
import type { EventSelect } from '../../prisma/prisma-client/models.ts';
import { createConnectionProcedure } from '../connection.ts';
import { procedure, router } from '../init.ts';
import { eventDataView, EventItem } from '../views.ts';

const transformEvent = (
  { attendees, ...event }: EventItem,
  args?: Record<string, unknown>,
) => ({
  ...event,
  attendees: arrayToConnection(attendees, {
    args: getScopedArgs(args, 'attendees'),
  }),
});

export const eventRouter = router({
  byId: procedure
    .input(
      z.object({
        args: connectionArgs,
        ids: z.array(z.string().min(1)).nonempty(),
        select: z.array(z.string()),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { resolveMany, select } = createResolver({
        ...input,
        ctx,
        view: eventDataView,
      });
      return (
        await resolveMany(
          await ctx.prisma.event.findMany({
            select: select as EventSelect,
            where: { id: { in: input.ids } },
          }),
        )
      ).map((event) => transformEvent(event, input.args));
    }),
  list: createConnectionProcedure({
    defaultSize: 3,
    map: ({ input, items }) =>
      (items as Array<EventItem>).map((event) =>
        transformEvent(event, input.args),
      ),
    query: async ({ ctx, cursor, direction, input, skip, take }) => {
      const { resolveMany, select } = createResolver({
        ...input,
        ctx,
        view: eventDataView,
      });

      const items = await ctx.prisma.event.findMany({
        orderBy: { startAt: 'asc' },
        select: select as EventSelect,
        take: direction === 'forward' ? take : -take,
        ...(cursor
          ? ({
              cursor: { id: cursor },
              skip,
            } as const)
          : null),
      });

      return resolveMany(direction === 'forward' ? items : items.reverse());
    },
  }),
});
