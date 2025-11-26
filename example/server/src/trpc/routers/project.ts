import {
  arrayToConnection,
  createSelectionResolver,
  getScopedArgs,
} from '@nkzw/fate/server';
import type { ProjectSelect } from '../../prisma/prisma-client/models.ts';
import { createConnectionProcedure } from '../connection.ts';
import { router } from '../init.ts';
import { projectDataView, ProjectItem } from '../views.ts';

export const projectRouter = router({
  list: createConnectionProcedure({
    defaultSize: 3,
    map: ({ input, items }) =>
      (items as Array<ProjectItem>).map(
        ({ updates, ...project }: ProjectItem) => ({
          ...project,
          updates: arrayToConnection(updates, {
            args: getScopedArgs(input.args, 'updates'),
          }),
        }),
      ),
    query: async ({ ctx, cursor, direction, input, skip, take }) => {
      const selection = createSelectionResolver({
        ...input,
        ctx,
        view: projectDataView,
      });

      const items = await ctx.prisma.project.findMany({
        orderBy: { createdAt: 'desc' },
        select: selection.select as ProjectSelect,
        take: direction === 'forward' ? take : -take,
        ...(cursor
          ? {
              cursor: { id: cursor },
              skip,
            }
          : {}),
      });
      return selection.resolveMany(
        direction === 'forward' ? items : items.reverse(),
      );
    },
  }),
});
