import {
  arrayToConnection,
  connectionArgs,
  createDataViewSelection,
  scopedArgsForPath,
} from '@nkzw/fate/server';
import { z } from 'zod';
import type { CategoryFindManyArgs } from '../../prisma/prisma-client/models.ts';
import { createConnectionProcedure } from '../connection.ts';
import { procedure, router } from '../init.ts';
import { categoryDataView, CategoryItem } from '../views.ts';

const transformCategory = (
  { _count, posts, ...category }: CategoryItem,
  args?: Record<string, unknown>,
) => ({
  ...category,
  postCount: _count?.posts ?? 0,
  posts: arrayToConnection(posts, {
    args: scopedArgsForPath(args, 'posts'),
  }),
});

export const categoryRouter = router({
  byId: procedure
    .input(
      z.object({
        args: connectionArgs,
        ids: z.array(z.string().min(1)).nonempty(),
        select: z.array(z.string()),
      }),
    )
    .query(async ({ ctx, input }) => {
      const selection = createDataViewSelection<CategoryItem>({
        args: input.args,
        context: ctx,
        paths: input.select,
        view: categoryDataView,
      });
      const categories = await ctx.prisma.category.findMany({
        select: selection.select,
        where: { id: { in: input.ids } },
      } as CategoryFindManyArgs);
      const resolved = await selection.resolveMany(
        categories as Array<CategoryItem>,
      );
      const map = new Map(
        resolved.map((category) => {
          const result = transformCategory(category, input.args);
          return [result.id, result];
        }),
      );
      return input.ids.map((id) => map.get(id)).filter(Boolean);
    }),
  list: createConnectionProcedure({
    map: ({ input, items }) =>
      (items as Array<CategoryItem>).map((category) =>
        transformCategory(category, input.args),
      ),
    query: async ({ ctx, cursor, direction, input, skip, take }) => {
      const selection = createDataViewSelection<CategoryItem>({
        args: input.args,
        context: ctx,
        paths: input.select,
        view: categoryDataView,
      });

      const findOptions: CategoryFindManyArgs = {
        orderBy: { createdAt: 'asc' },
        select: selection.select,
        take: direction === 'forward' ? take : -take,
      };

      if (cursor) {
        findOptions.cursor = { id: cursor };
        findOptions.skip = skip;
      }

      const items = await ctx.prisma.category.findMany(findOptions);
      return selection.resolveMany(
        direction === 'forward' ? items : items.reverse(),
      );
    },
  }),
});
