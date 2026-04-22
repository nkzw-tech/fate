import { byIdInput, createViewPlan } from '@nkzw/fate/server';
import { getTagsByIds } from '../../drizzle/queries.ts';
import { procedure, router } from '../init.ts';
import { tagDataView } from '../views.ts';

export const tagRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    const plan = createViewPlan({
      ...input,
      ctx,
      view: tagDataView,
    });
    return plan.resolveMany(await getTagsByIds(input.ids));
  }),
});
