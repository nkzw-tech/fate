import { byIdInput } from '@nkzw/fate/server';
import { createConnectionProcedure } from '../connection.ts';
import { createPrismaPlan, executePrismaByIds, executePrismaConnection } from '../executor.ts';
import { procedure, router } from '../init.ts';
import { categorySource } from '../views.ts';

export const categoryRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    return executePrismaByIds({
      ctx,
      ids: input.ids,
      plan: createPrismaPlan({
        ctx,
        input,
        source: categorySource,
      }),
    });
  }),
  list: createConnectionProcedure({
    query: async ({ ctx, cursor, direction, input, skip, take }) => {
      return executePrismaConnection({
        ctx,
        cursor,
        direction,
        plan: createPrismaPlan({
          ctx,
          input,
          source: categorySource,
        }),
        skip,
        take,
      });
    },
  }),
});
