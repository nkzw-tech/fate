import { byIdInput, createExecutionPlan } from '@nkzw/fate/server';
import { fetchEventsByIds, fetchEventsConnection } from '../../drizzle/queries.ts';
import { createConnectionProcedure } from '../connection.ts';
import { procedure, router } from '../init.ts';
import { eventSource } from '../views.ts';

export const eventRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    const plan = createExecutionPlan({
      ...input,
      ctx,
      source: eventSource,
    });
    return plan.resolveMany(await fetchEventsByIds(input.ids, plan.root));
  }),
  list: createConnectionProcedure({
    defaultSize: 3,
    query: async ({ ctx, cursor, direction, input, take }) => {
      const plan = createExecutionPlan({
        ...input,
        ctx,
        source: eventSource,
      });
      return plan.resolveMany(
        await fetchEventsConnection({ cursor, direction, node: plan.root, take }),
      );
    },
  }),
});
