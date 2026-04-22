import { byIdInput } from '@nkzw/fate/server';
import { createDrizzlePlan, executeDrizzleByIds } from '../executor.ts';
import { procedure, router } from '../init.ts';
import { tagSource } from '../views.ts';

export const tagRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    return executeDrizzleByIds({
      ids: input.ids,
      plan: createDrizzlePlan({
        ctx,
        input,
        source: tagSource,
      }),
    });
  }),
});
