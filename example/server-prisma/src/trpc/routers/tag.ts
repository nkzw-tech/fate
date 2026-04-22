import { byIdInput } from '@nkzw/fate/server';
import { createPrismaPlan, executePrismaByIds } from '../executor.ts';
import { procedure, router } from '../init.ts';
import { tagSource } from '../views.ts';

export const tagRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    return executePrismaByIds({
      ctx,
      ids: input.ids,
      plan: createPrismaPlan({
        ctx,
        input,
        source: tagSource,
      }),
    });
  }),
});
