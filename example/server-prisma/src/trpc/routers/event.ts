import { byIdInput, createExecutionPlan, toPrismaSelect } from '@nkzw/fate/server';
import type { EventSelect } from '../../prisma/prisma-client/models.ts';
import { createConnectionProcedure } from '../connection.ts';
import { procedure, router } from '../init.ts';
import { prismaConnectionArgs } from '../source.ts';
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
        ...prismaConnectionArgs({ cursor, direction, node: plan.root, skip, take }),
        select: toPrismaSelect(plan) as EventSelect,
      });

      return plan.resolveMany(direction === 'forward' ? items : items.reverse());
    },
  }),
});
