import { byIdInput, createResolver } from '@nkzw/fate/server';
import type { CategoryFindManyArgs } from '../../prisma/prisma-client/models.ts';
import { createConnectionProcedure } from '../connection.ts';
import { procedure, router } from '../init.ts';
import { categoryDataView } from '../views.ts';

export const categoryRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    const { resolveMany, select } = createResolver({
      ...input,
      ctx,
      view: categoryDataView,
    });
    return resolveMany(
      await ctx.prisma.category.findMany({
        select,
        where: { id: { in: input.ids } },
      } as CategoryFindManyArgs),
    );
  }),
  list: createConnectionProcedure({
    query: async ({ ctx, cursor, direction, input, skip, take }) => {
      const { resolveMany, select } = createResolver({
        ...input,
        ctx,
        view: categoryDataView,
      });

      const findOptions: CategoryFindManyArgs = {
        orderBy: { createdAt: 'asc' },
        select,
        take: direction === 'forward' ? take : -take,
      };

      if (cursor) {
        findOptions.cursor = { id: cursor };
        findOptions.skip = skip;
      }

      const items = await ctx.prisma.category.findMany(findOptions);
      return resolveMany(direction === 'forward' ? items : items.reverse());
    },
  }),
});
