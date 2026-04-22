import { byIdInput, createExecutionPlan, toPrismaSelect } from '@nkzw/fate/server';
import type { EventSelect } from '../../prisma/prisma-client/models.ts';
import { createConnectionProcedure } from '../connection.ts';
import { procedure, router } from '../init.ts';
import { eventSource } from '../views.ts';

export const eventRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    const plan = createExecutionPlan({
      ...input,
      ctx,
      source: eventSource,
    });
    return plan.resolveMany(
      await ctx.prisma.event.findMany({
        select: toPrismaSelect(plan) as EventSelect,
        where: { id: { in: input.ids } },
      }),
    );
  }),
  list: createConnectionProcedure({
    defaultSize: 3,
    query: async ({ ctx, cursor, direction, input, skip, take }) => {
      const plan = createExecutionPlan({
        ...input,
        ctx,
        source: eventSource,
      });

      const items = await ctx.prisma.event.findMany({
        orderBy: { startAt: 'asc' },
        select: toPrismaSelect(plan) as EventSelect,
        take: direction === 'forward' ? take : -take,
        ...(cursor
          ? ({
              cursor: { id: cursor },
              skip,
            } as const)
          : null),
      });

      return plan.resolveMany(direction === 'forward' ? items : items.reverse());
    },
  }),
});
