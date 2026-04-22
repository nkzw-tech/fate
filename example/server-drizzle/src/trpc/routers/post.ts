import { byIdInput, connectionArgs, createViewPlan } from '@nkzw/fate/server';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  createPostRecord,
  fetchPostById,
  fetchPostsByIds,
  fetchPostsConnection,
  likePostRecord,
  unlikePostRecord,
} from '../../drizzle/queries.ts';
import { createConnectionProcedure } from '../connection.ts';
import { procedure, router } from '../init.ts';
import { Post, postDataView } from '../views.ts';

export const postRouter = router({
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

      const plan = createViewPlan({
        ...input,
        ctx,
        view: postDataView,
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

      const post = await fetchPostById(postId, plan.root);
      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found.',
        });
      }

      return (await plan.resolve(post)) as Post;
    }),
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    const plan = createViewPlan({
      ...input,
      ctx,
      view: postDataView,
    });
    return plan.resolveMany(await fetchPostsByIds(input.ids, plan.root));
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

      const existing = await fetchPostById(
        input.id,
        createViewPlan({
          ctx,
          select: ['id'],
          view: postDataView,
        }).root,
      );

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found.',
        });
      }

      const plan = createViewPlan({
        ...input,
        ctx,
        view: postDataView,
      });

      const updated = await likePostRecord(input.id);
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found.',
        });
      }

      const post = await fetchPostById(input.id, plan.root);
      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found.',
        });
      }

      return (await plan.resolve(post)) as Post;
    }),
  list: createConnectionProcedure({
    query: async ({ ctx, cursor, direction, input, take }) => {
      const plan = createViewPlan({
        ...input,
        ctx,
        view: postDataView,
      });
      return plan.resolveMany(
        await fetchPostsConnection({ cursor, direction, node: plan.root, take }),
      );
    },
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
      const plan = createViewPlan({
        ...input,
        ctx,
        view: postDataView,
      });

      const updated = await unlikePostRecord(input.id);
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found',
        });
      }

      const post = await fetchPostById(input.id, plan.root);
      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found',
        });
      }

      return (await plan.resolve(post)) as Post;
    }),
});
