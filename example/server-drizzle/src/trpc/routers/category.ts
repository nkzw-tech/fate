import { byIdInput, createResolver } from '@nkzw/fate/server';
import { getCategoriesByIds, listCategoriesConnection } from '../../drizzle/queries.ts';
import { createConnectionProcedure } from '../connection.ts';
import { procedure, router } from '../init.ts';
import { categoryDataView } from '../views.ts';

export const categoryRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    const { resolveMany } = createResolver({
      ...input,
      ctx,
      view: categoryDataView,
    });
    return resolveMany(await getCategoriesByIds(input.ids));
  }),
  list: createConnectionProcedure({
    query: async ({ ctx, cursor, direction, input, take }) => {
      const { resolveMany } = createResolver({
        ...input,
        ctx,
        view: categoryDataView,
      });
      const items = await listCategoriesConnection({ cursor, direction, take });
      return resolveMany(items);
    },
  }),
});
