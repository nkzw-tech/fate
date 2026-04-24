import { connectionArgs, toPrismaSelect } from '@nkzw/fate/server';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { auth } from '../../lib/auth.tsx';
import type { UserFindUniqueArgs } from '../../prisma/prisma-client/models.ts';
import { fate, procedure, router } from '../init.ts';
import { User, userDataView } from '../views.ts';

export const userRouter = router({
  update: procedure
    .input(
      z.object({
        args: connectionArgs,
        name: z
          .string()
          .trim()
          .min(2, 'Name must be at least 2 characters.')
          .max(50, 'Name must be at most 32 characters.'),
        select: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.sessionUser) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'You must be logged in to update your name.',
        });
      }

      const plan = fate.createPlan({
        ...input,
        ctx,
        view: userDataView,
      });
      const select = toPrismaSelect(plan);

      await auth.api.updateUser({
        body: { name: input.name },
        headers: ctx.headers,
      });

      return plan.resolve(
        await ctx.prisma.user.findUniqueOrThrow({
          select,
          where: { id: ctx.sessionUser.id },
        } as UserFindUniqueArgs),
      );
    }),
  viewer: procedure
    .input(
      z.object({
        select: z.array(z.string()),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.sessionUser) {
        return null;
      }

      return (await fate.resolveById({
        ctx,
        id: ctx.sessionUser.id,
        input,
        view: userDataView,
      })) as User | null;
    }),
});
