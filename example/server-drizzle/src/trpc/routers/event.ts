import {
  byIdInput,
  createExecutionPlan,
  executeSourceByIds,
  executeSourceConnection,
} from '@nkzw/fate/server';
import { createConnectionProcedure } from '../connection.ts';
import { drizzleRegistry } from '../executor.ts';
import { procedure, router } from '../init.ts';
import { eventSource } from '../views.ts';

export const eventRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) =>
    executeSourceByIds({
      ctx,
      ids: input.ids,
      plan: createExecutionPlan({ ...input, ctx, source: eventSource }),
      registry: drizzleRegistry,
    }),
  ),
  list: createConnectionProcedure({
    defaultSize: 3,
    query: async ({ ctx, cursor, direction, input, take }) =>
      executeSourceConnection({
        ctx,
        cursor,
        direction,
        plan: createExecutionPlan({ ...input, ctx, source: eventSource }),
        registry: drizzleRegistry,
        take,
      }),
  }),
});
