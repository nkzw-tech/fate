import { byIdInput, createExecutionPlan, executeSourceByIds } from '@nkzw/fate/server';
import { drizzleRegistry } from '../executor.ts';
import { procedure, router } from '../init.ts';
import { tagSource } from '../views.ts';

export const tagRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) =>
    executeSourceByIds({
      ctx,
      ids: input.ids,
      plan: createExecutionPlan({ ...input, ctx, source: tagSource }),
      registry: drizzleRegistry,
    }),
  ),
});
