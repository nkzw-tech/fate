import { z } from 'zod';
import { prismaSelect } from '../../fate-server/prismaSelect.tsx';
import { procedure, router } from '../init.ts';

export const tagRouter = router({
  byId: procedure
    .input(
      z.object({
        ids: z.array(z.string().min(1)).nonempty(),
        select: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const select = prismaSelect(input?.select);

      const tags = await ctx.prisma.tag.findMany({
        where: { id: { in: input.ids } },
        ...(select ? { select } : undefined),
      });

      const map = new Map(tags.map((tag) => [tag.id, tag]));
      return input.ids.map((id) => map.get(id)).filter(Boolean);
    }),
});
