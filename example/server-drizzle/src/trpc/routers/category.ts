import { byIdInput } from '@nkzw/fate/server';
import { createConnectionProcedure } from '../connection.ts';
import { createDrizzlePlan, executeDrizzleByIds, executeDrizzleConnection } from '../executor.ts';
import { procedure, router } from '../init.ts';
import { categorySource } from '../views.ts';

export const categoryRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    return executeDrizzleByIds({
      ids: input.ids,
      plan: createDrizzlePlan({
        ctx,
        input,
        source: categorySource,
      }),
    });
  }),
  list: createConnectionProcedure({
    query: async ({ ctx, cursor, direction, input, take }) => {
      return executeDrizzleConnection({
        cursor,
        direction,
        plan: createDrizzlePlan({
          ctx,
          input,
          source: categorySource,
        }),
        take,
      });
    },
  }),
});
