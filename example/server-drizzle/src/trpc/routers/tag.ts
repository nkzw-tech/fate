import { byIdInput, createExecutionPlan } from '@nkzw/fate/server';
import { getTagsByIds } from '../../drizzle/queries.ts';
import { procedure, router } from '../init.ts';
import { tagSource } from '../views.ts';

export const tagRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    const plan = createExecutionPlan({
      ...input,
      ctx,
      source: tagSource,
    });
    return plan.resolveMany(await getTagsByIds(input.ids));
  }),
});
