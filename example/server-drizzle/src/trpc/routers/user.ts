import { connectionArgs, resolveSourceById } from '@nkzw/fate/server';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { auth } from '../../lib/auth.tsx';
import { drizzleRegistry } from '../executor.ts';
import { procedure, router } from '../init.ts';
import { User, userSource } from '../views.ts';

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

      await auth.api.updateUser({
        body: { name: input.name },
        headers: ctx.headers,
      });

      const user = await resolveSourceById({
        ctx,
        id: ctx.sessionUser.id,
        input,
        registry: drizzleRegistry,
        source: userSource,
      });
      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found.',
        });
      }

      return user;
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

      return (await resolveSourceById({
        ctx,
        id: ctx.sessionUser.id,
        input,
        registry: drizzleRegistry,
        source: userSource,
      })) as User | null;
    }),
});
