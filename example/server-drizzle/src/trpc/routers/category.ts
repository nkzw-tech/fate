import {
  byIdInput,
  createExecutionPlan,
  executeSourceByIds,
  executeSourceConnection,
} from '@nkzw/fate/server';
import { createConnectionProcedure } from '../connection.ts';
import { drizzleRegistry } from '../executor.ts';
import { procedure, router } from '../init.ts';
import { categorySource } from '../views.ts';

export const categoryRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) =>
    executeSourceByIds({
      ctx,
      ids: input.ids,
      plan: createExecutionPlan({ ...input, ctx, source: categorySource }),
      registry: drizzleRegistry,
    }),
  ),
  list: createConnectionProcedure({
    query: async ({ ctx, cursor, direction, input, take }) =>
      executeSourceConnection({
        ctx,
        cursor,
        direction,
        plan: createExecutionPlan({ ...input, ctx, source: categorySource }),
        registry: drizzleRegistry,
        take,
      }),
  }),
});
