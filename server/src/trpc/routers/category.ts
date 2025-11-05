import { z } from 'zod';
import { createConnectionProcedure } from '../../fate-server/connection.ts';
import { prismaSelect } from '../../fate-server/prismaSelect.tsx';
import { Category } from '../../prisma/prisma-client/client.ts';
import { CategoryFindManyArgs } from '../../prisma/prisma-client/models.ts';
import { procedure, router } from '../init.ts';

const categorySelect = {
  _count: {
    select: { posts: true },
  },
  id: true,
} as const;

export const categoryRouter = router({
  byId: procedure
    .input(
      z.object({
        ids: z.array(z.string().min(1)).nonempty(),
        select: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const select = prismaSelect(input.select);
      const categories = await ctx.prisma.category.findMany({
        select,
        where: { id: { in: input.ids } },
      } as CategoryFindManyArgs);

      const map = new Map(
        categories.map((category) => [category.id, category]),
      );
      return input.ids.map((id) => map.get(id)).filter(Boolean);
    }),
  list: createConnectionProcedure({
    map: ({ rows }) =>
      (rows as Array<Category & { _count: { posts: number } }>).map(
        ({ _count, ...category }) => ({
          ...category,
          postCount: _count.posts,
        }),
      ),
    query: async ({ ctx, cursor, input, skip, take }) => {
      const select = prismaSelect(input?.select);
      delete select?.postCount;

      const findOptions: CategoryFindManyArgs = {
        orderBy: { createdAt: 'asc' },
        select: { ...select, ...categorySelect },
        take,
      };

      if (cursor) {
        findOptions.cursor = { id: cursor };
        findOptions.skip = skip;
      }

      return await ctx.prisma.category.findMany(findOptions);
    },
  }),
});
