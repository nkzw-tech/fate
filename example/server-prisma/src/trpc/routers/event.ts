import { byIdInput } from '@nkzw/fate/server';
import { createConnectionProcedure } from '../connection.ts';
import { createPrismaPlan, executePrismaByIds, executePrismaConnection } from '../executor.ts';
import { procedure, router } from '../init.ts';
import { eventSource } from '../views.ts';

export const eventRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    return executePrismaByIds({
      ctx,
      ids: input.ids,
      plan: createPrismaPlan({
        ctx,
        input,
        source: eventSource,
      }),
    });
  }),
  list: createConnectionProcedure({
    defaultSize: 3,
    query: async ({ ctx, cursor, direction, input, skip, take }) => {
      return executePrismaConnection({
        ctx,
        cursor,
        direction,
        plan: createPrismaPlan({
          ctx,
          input,
          source: eventSource,
        }),
        skip,
        take,
      });
    },
  }),
});
