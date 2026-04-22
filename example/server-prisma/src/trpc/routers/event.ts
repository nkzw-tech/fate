import {
  byIdInput,
  createExecutionPlan,
  executeSourceByIds,
  executeSourceConnection,
} from '@nkzw/fate/server';
import { createConnectionProcedure } from '../connection.ts';
import { prismaRegistry } from '../executor.ts';
import { procedure, router } from '../init.ts';
import { eventSource } from '../views.ts';

export const eventRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) =>
    executeSourceByIds({
      ctx,
      ids: input.ids,
      plan: createExecutionPlan({ ...input, ctx, source: eventSource }),
      registry: prismaRegistry,
    }),
  ),
  list: createConnectionProcedure({
    defaultSize: 3,
    query: async ({ ctx, cursor, direction, input, skip, take }) =>
      executeSourceConnection({
        ctx,
        cursor,
        direction,
        plan: createExecutionPlan({ ...input, ctx, source: eventSource }),
        registry: prismaRegistry,
        skip,
        take,
      }),
  }),
});
