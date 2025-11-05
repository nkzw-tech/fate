import { z } from 'zod';
import { CategoryFindManyArgs } from '../../prisma/prisma-client/models.ts';
import { prismaSelect } from '../../prisma/prismaSelect.tsx';
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
  list: procedure
    .input(
      z.object({
        after: z.string().optional(),
        first: z.number().int().positive().optional(),
        select: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const take = (input.first ?? 20) + 1;
      const select = prismaSelect(input?.select);

      delete select?.postCount;

      const categories = await ctx.prisma.category.findMany({
        orderBy: { createdAt: 'asc' },
        select: { ...select, ...categorySelect },
        take,
      });

      const rows = categories.map(({ _count, ...category }) => ({
        ...category,
        postCount: _count.posts,
      }));

      const hasNext = rows.length > (input.first ?? 20);
      const limited = rows.slice(0, input.first ?? 20);
      return {
        edges: limited.map((node) => ({ cursor: node.id, node })),
        pageInfo: {
          endCursor: limited.length ? limited.at(-1)!.id : undefined,
          hasNextPage: hasNext,
        },
      };
    }),
});
