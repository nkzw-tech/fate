import { byIdInput, createExecutionPlan, toPrismaSelect } from '@nkzw/fate/server';
import type { CategoryFindManyArgs } from '../../prisma/prisma-client/models.ts';
import { createConnectionProcedure } from '../connection.ts';
import { procedure, router } from '../init.ts';
import { prismaConnectionArgs } from '../source.ts';
import { categorySource } from '../views.ts';

export const categoryRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    const plan = createExecutionPlan({
      ...input,
      ctx,
      source: categorySource,
    });
    return plan.resolveMany(
      await ctx.prisma.category.findMany({
        select: toPrismaSelect(plan),
        where: { id: { in: input.ids } },
      } as CategoryFindManyArgs),
    );
  }),
  list: createConnectionProcedure({
    query: async ({ ctx, cursor, direction, input, skip, take }) => {
      const plan = createExecutionPlan({
        ...input,
        ctx,
        source: categorySource,
      });

      const findOptions: CategoryFindManyArgs = {
        ...prismaConnectionArgs({ cursor, direction, node: plan.root, skip, take }),
        select: toPrismaSelect(plan),
      };

      const items = await ctx.prisma.category.findMany(findOptions);
      return plan.resolveMany(direction === 'forward' ? items : items.reverse());
    },
  }),
});
