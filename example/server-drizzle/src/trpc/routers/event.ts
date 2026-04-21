import { byIdInput, createResolver } from '@nkzw/fate/server';
import { getEventsByIds, listEventsConnection } from '../../drizzle/queries.ts';
import { createConnectionProcedure } from '../connection.ts';
import { procedure, router } from '../init.ts';
import { eventDataView } from '../views.ts';

export const eventRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    const { resolveMany } = createResolver({
      ...input,
      ctx,
      view: eventDataView,
    });
    return resolveMany(await getEventsByIds(input.ids));
  }),
  list: createConnectionProcedure({
    defaultSize: 3,
    query: async ({ ctx, cursor, direction, input, take }) => {
      const { resolveMany } = createResolver({
        ...input,
        ctx,
        view: eventDataView,
      });
      const items = await listEventsConnection({ cursor, direction, take });
      return resolveMany(items);
    },
  }),
});
