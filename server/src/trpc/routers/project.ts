import { createConnectionProcedure } from '../../fate-server/connection.ts';
import { prismaSelect } from '../../fate-server/prismaSelect.tsx';
import { router } from '../init.ts';

const projectSelect = {
  focusAreas: true,
  id: true,
  metrics: true,
  name: true,
  progress: true,
  startDate: true,
  status: true,
  summary: true,
  targetDate: true,
  updates: {
    select: {
      confidence: true,
      content: true,
      createdAt: true,
      id: true,
      mood: true,
    },
  },
} as const;

export const projectRouter = router({
  list: createConnectionProcedure({
    defaultSize: 3,
    query: async ({ ctx, cursor, input, skip, take }) => {
      const select = prismaSelect(input?.select);

      return ctx.prisma.project.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          ...projectSelect,
          ...(select ?? {}),
        },
        take,
        ...(cursor
          ? {
              cursor: { id: cursor },
              skip,
            }
          : {}),
      });
    },
  }),
});
