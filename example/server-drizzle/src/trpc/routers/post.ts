import { connectionArgs, createExecutionPlan, executeSourceById } from '@nkzw/fate/server';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createPostRecord, likePostRecord, unlikePostRecord } from '../../drizzle/queries.ts';
import { drizzleRegistry } from '../executor.ts';
import { procedure, router } from '../init.ts';
import { sourceProcedures } from '../sourceRouter.ts';
import { Post, postSource } from '../views.ts';

export const postRouter = router({
  ...sourceProcedures(postSource),
  add: procedure
    .input(
      z.object({
        args: connectionArgs,
        content: z.string().min(1, 'Content is required'),
        select: z.array(z.string()),
        title: z.string().min(1, 'Title is required'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.sessionUser) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'You must be logged in to add a comment',
        });
      }

      const plan = createExecutionPlan({
        ...input,
        ctx,
        source: postSource,
      });

      const postId = await createPostRecord({
        authorId: ctx.sessionUser.id,
        content: input.content,
        title: input.title,
      });

      if (!postId) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create post.',
        });
      }

      const post = await executeSourceById({
        ctx,
        id: postId,
        plan,
        registry: drizzleRegistry,
      });
      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found.',
        });
      }

      return post as Post;
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

      const existing = await executeSourceById({
        ctx,
        id: input.id,
        plan: createExecutionPlan({
          ctx,
          select: ['id'],
          source: postSource,
        }),
        registry: drizzleRegistry,
      });

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found.',
        });
      }

      const plan = createExecutionPlan({
        ...input,
        ctx,
        source: postSource,
      });

      const updated = await likePostRecord(input.id);
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found.',
        });
      }

      const post = await executeSourceById({
        ctx,
        id: input.id,
        plan,
        registry: drizzleRegistry,
      });
      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found.',
        });
      }

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
      const plan = createExecutionPlan({
        ...input,
        ctx,
        source: postSource,
      });

      const updated = await unlikePostRecord(input.id);
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found',
        });
      }

      const post = await executeSourceById({
        ctx,
        id: input.id,
        plan,
        registry: drizzleRegistry,
      });
      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found',
        });
      }

      return post as Post;
    }),
});
