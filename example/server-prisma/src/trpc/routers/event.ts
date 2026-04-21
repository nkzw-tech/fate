import { byIdInput, createResolver } from '@nkzw/fate/server';
import type { EventSelect } from '../../prisma/prisma-client/models.ts';
import { createConnectionProcedure } from '../connection.ts';
import { procedure, router } from '../init.ts';
import { eventDataView } from '../views.ts';

export const eventRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    const { resolveMany, select } = createResolver({
      ...input,
      ctx,
      view: eventDataView,
    });
    return resolveMany(
      await ctx.prisma.event.findMany({
        select: select as EventSelect,
        where: { id: { in: input.ids } },
      }),
    );
  }),
  list: createConnectionProcedure({
    defaultSize: 3,
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
