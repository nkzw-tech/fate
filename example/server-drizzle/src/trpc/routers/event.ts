import { byIdInput } from '@nkzw/fate/server';
import { createConnectionProcedure } from '../connection.ts';
import { createDrizzlePlan, executeDrizzleByIds, executeDrizzleConnection } from '../executor.ts';
import { procedure, router } from '../init.ts';
import { eventSource } from '../views.ts';

export const eventRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    return executeDrizzleByIds({
      ids: input.ids,
      plan: createDrizzlePlan({
        ctx,
        input,
        source: eventSource,
      }),
    });
  }),
  list: createConnectionProcedure({
    defaultSize: 3,
    query: async ({ ctx, cursor, direction, input, take }) => {
      return executeDrizzleConnection({
        cursor,
        direction,
        plan: createDrizzlePlan({
          ctx,
          input,
          source: eventSource,
        }),
        take,
      });
    },
  }),
});
