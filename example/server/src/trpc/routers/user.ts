import { connectionArgs, createResolver } from '@nkzw/fate/server';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { UserFindUniqueArgs } from '../../prisma/prisma-client/models.ts';
import { auth } from '../../lib/auth.tsx';
import { procedure, router } from '../init.ts';
import { userDataView } from '../views.ts';

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

      const { resolve, select } = createResolver({
        ...input,
        ctx,
        view: userDataView,
      });

      await auth.api.updateUser({
        body: { name: input.name },
        headers: ctx.headers,
      });

      return resolve(
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
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'You must be logged in to view your profile',
        });
      }

      const { resolve, select } = createResolver({
        ...input,
        ctx,
        view: userDataView,
      });

      return resolve(
        await ctx.prisma.user.findUniqueOrThrow({
          select,
          where: { id: ctx.sessionUser.id },
        } as UserFindUniqueArgs),
      );
    }),
});
