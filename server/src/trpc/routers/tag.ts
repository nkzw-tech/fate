import { connectionArgs, createDataViewSelection } from '@nkzw/fate/server';
import { z } from 'zod';
import type { Tag } from '../../prisma/prisma-client/client.ts';
import type { TagFindManyArgs } from '../../prisma/prisma-client/models.ts';
import { procedure, router } from '../init.ts';
import { tagDataView } from '../views.ts';

export const tagRouter = router({
  byId: procedure
    .input(
      z.object({
        args: connectionArgs,
        ids: z.array(z.string().min(1)).nonempty(),
        select: z.array(z.string()),
      }),
    )
    .query(async ({ ctx, input }) => {
      const selection = createDataViewSelection<Tag>({
        args: input.args,
        context: ctx,
        paths: input.select,
        view: tagDataView,
      });

      const tags = await ctx.prisma.tag.findMany({
        select: selection.select,
        where: { id: { in: input.ids } },
      } as TagFindManyArgs);

      const resolved = await selection.resolveMany(tags as Array<Tag>);
      const map = new Map(resolved.map((tag) => [tag.id, tag] as const));
      return input.ids
        .map((id) => map.get(id))
        .filter((tag): tag is (typeof resolved)[number] => tag != null);
    }),
});
