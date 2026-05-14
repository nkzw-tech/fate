import { connectionArgs } from '@nkzw/fate/server';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { likePostRecord, unlikePostRecord } from '../../drizzle/queries.ts';
import { fate, live, procedure, router } from '../init.ts';
import { Post, postDataView } from '../views.ts';

export const postRouter = router({
  ...fate.procedures({
    view: postDataView,
  }),
  like: procedure
    .input(
      z.object({
        args: connectionArgs,
        error: z.enum(['boundary', 'callSite']).optional(),
        id: z.string().min(1, 'Post id is required.'),
        select: z.array(z.string()),
        slow: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.slow) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      if (input.error === 'boundary') {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Simulated error.',
        });
      } else if (input.error === 'callSite') {
        await new Promise((resolve) => setTimeout(resolve, 200));
        throw new TRPCError({
          code: 'PAYMENT_REQUIRED',
          message: 'Gotta pay up.',
        });
      }

      const updated = await likePostRecord(input.id);
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found.',
        });
      }

      const post = await fate.resolveById({
        ctx,
        id: input.id,
        input,
        view: postDataView,
      });
      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found.',
        });
      }

      live.update('Post', input.id, { changed: ['likes'] });

      return post as Post;
    }),
  unlike: procedure
    .input(
      z.object({
        args: connectionArgs,
        id: z.string().min(1, 'Post id is required.'),
        select: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await unlikePostRecord(input.id);
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found',
        });
      }

      const post = await fate.resolveById({
        ctx,
        id: input.id,
        input,
        view: postDataView,
      });
      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found',
        });
      }

      live.update('Post', input.id, { changed: ['likes'] });

      return post as Post;
    }),
});
