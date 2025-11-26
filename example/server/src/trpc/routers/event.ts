import {
  arrayToConnection,
  connectionArgs,
  createSelectionResolver,
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
      const selection = createSelectionResolver({
        ...input,
        ctx,
        view: eventDataView,
      });
      const events = await ctx.prisma.event.findMany({
        select: selection.select as EventSelect,
        where: { id: { in: input.ids } },
      });
      const resolved = await selection.resolveMany(events);

      const map = new Map(
        resolved.map((event) => {
          const result = transformEvent(event, input.args);
          return [result.id, result];
        }),
      );
      return input.ids.map((id) => map.get(id)).filter(Boolean);
    }),
  list: createConnectionProcedure({
    defaultSize: 3,
    map: ({ input, items }) =>
      (items as Array<EventItem>).map((event) =>
        transformEvent(event, input.args),
      ),
    query: async ({ ctx, cursor, direction, input, skip, take }) => {
      const selection = createSelectionResolver({
        ...input,
        ctx,
        view: eventDataView,
      });

      const items = await ctx.prisma.event.findMany({
        orderBy: { startAt: 'asc' },
        select: selection.select as EventSelect,
        take: direction === 'forward' ? take : -take,
        ...(cursor
          ? ({
              cursor: { id: cursor },
              skip,
            } as const)
          : null),
      });

      return selection.resolveMany(
        direction === 'forward' ? items : items.reverse(),
      );
    },
  }),
});
