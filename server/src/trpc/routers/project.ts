import { z } from 'zod';
import { prismaSelect } from '../../prisma/prismaSelect.tsx';
import { procedure, router } from '../init.ts';

const projectSelect = {
  focusAreas: true,
  id: true,
  metrics: true,
  updates: {
    select: {
      confidence: true,
      mood: true,
    },
  },
} as const;

export const projectRouter = router({
  list: procedure
    .input(
      z.object({
        after: z.string().optional(),
        first: z.number().int().positive().optional(),
        select: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const take = (input.first ?? 3) + 1;
      const select = prismaSelect(input?.select);

      const rows = await ctx.prisma.project.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          ...projectSelect,
          ...select,
        },
        take,
      });

      const hasNext = rows.length > (input.first ?? 20);
      const limited = rows.slice(0, input.first ?? 20);
      return {
        items: limited.map((node) => ({ cursor: node.id, node })),
        pagination: {
          hasNext,
          hasPrevious: Boolean(input.after),
          nextCursor: limited.length ? limited.at(-1)!.id : undefined,
          previousCursor: input.after,
        },
      };
    }),
});
