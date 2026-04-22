import { byIdInput, createExecutionPlan, toPrismaSelect } from '@nkzw/fate/server';
import type { TagFindManyArgs } from '../../prisma/prisma-client/models.ts';
import { procedure, router } from '../init.ts';
import { tagSource } from '../views.ts';

export const tagRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    const plan = createExecutionPlan({
      ...input,
      ctx,
      source: tagSource,
    });

    return await plan.resolveMany(
      await ctx.prisma.tag.findMany({
        select: toPrismaSelect(plan),
        where: { id: { in: input.ids } },
      } as TagFindManyArgs),
    );
  }),
});
