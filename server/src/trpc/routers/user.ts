import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { prismaSelect } from '../../fate-server/prismaSelect.tsx';
import { auth } from '../../lib/auth.tsx';
import { procedure, router } from '../init.ts';

const defaultSelection = {
  id: true,
  name: true,
  username: true,
} as const;

export const userRouter = router({
  update: procedure
    .input(
      z.object({
        name: z
          .string()
          .trim()
          .min(2, 'Name must be at least 2 characters.')
          .max(50, 'Name must be at most 32 characters.'),
        select: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.sessionUser) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'You must be logged in to update your name.',
        });
      }

      const select = prismaSelect(input.select);

      await auth.api.updateUser({
        body: { name: input.name },
        headers: ctx.headers,
      });

      return await ctx.prisma.user.findUniqueOrThrow({
        select: select || defaultSelection,
        where: { id: ctx.sessionUser.id },
      });
    }),
});
