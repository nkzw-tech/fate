import { byIdInput, createExecutionPlan } from '@nkzw/fate/server';
import { fetchCategoriesByIds, fetchCategoriesConnection } from '../../drizzle/queries.ts';
import { createConnectionProcedure } from '../connection.ts';
import { procedure, router } from '../init.ts';
import { categorySource } from '../views.ts';

export const categoryRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    const plan = createExecutionPlan({
      ...input,
      ctx,
      source: categorySource,
    });
    return plan.resolveMany(await fetchCategoriesByIds(input.ids, plan.root));
  }),
  list: createConnectionProcedure({
    query: async ({ ctx, cursor, direction, input, take }) => {
      const plan = createExecutionPlan({
        ...input,
        ctx,
        source: categorySource,
      });
      return plan.resolveMany(
        await fetchCategoriesConnection({ cursor, direction, node: plan.root, take }),
      );
    },
  }),
});
