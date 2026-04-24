import {
  hasNestedSelection,
  connectionArgs,
  createExecutionPlan,
  createNestedExecutionPlan,
  executeSourceConnection,
  refetchSourceById,
} from '@nkzw/fate/server';
import { TRPCError } from '@trpc/server';
import { ilike } from 'drizzle-orm';
import { z } from 'zod';
import {
  type CommentItem,
  type PostItem,
  createCommentRecord,
  deleteCommentRecord,
} from '../../drizzle/queries.ts';
import { comment } from '../../drizzle/schema.ts';
import { drizzleRegistry, drizzleRuntime } from '../executor.ts';
import { procedure, router } from '../init.ts';
import { createConnectionProcedure, sourceProcedures } from '../sourceRouter.ts';
import { commentSource, postSource } from '../views.ts';

export const commentRouter = router({
  ...sourceProcedures({
    list: false,
    source: commentSource,
  }),
  add: procedure
    .input(
      z.object({
        args: connectionArgs,
        content: z.string().min(1, 'Content is required'),
        postId: z.string().min(1, 'Post id is required'),
        select: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.sessionUser) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'You must be logged in to add a comment',
        });
      }

      const post = await refetchSourceById({
        ctx,
        id: input.postId,
        input: { select: ['id'] },
        registry: drizzleRegistry,
        source: postSource,
      });

      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found',
        });
      }

      const commentId = await createCommentRecord({
        authorId: ctx.sessionUser.id,
        content: input.content,
        postId: input.postId,
      });

      if (!commentId) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create comment.',
        });
      }

      const comment = await refetchSourceById({
        ctx,
        id: commentId,
        input,
        registry: drizzleRegistry,
        source: commentSource,
      });
      if (!comment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        });
      }

      return comment as CommentItem & { post?: { commentCount: number } };
    }),
  delete: procedure
    .input(
      z.object({
        args: connectionArgs.optional(),
        id: z.string().min(1, 'Comment id is required'),
        select: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plan = createExecutionPlan({
        ...input,
        ctx,
        source: commentSource,
      });

      const comment = await drizzleRuntime.fetchById<CommentItem>({
        extra: { extraFields: ['authorId', 'postId'] },
        id: input.id,
        plan,
      });

      if (!comment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        });
      }

      if (comment.authorId && comment.authorId !== ctx.sessionUser?.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only delete your own comments.',
        });
      }

      await deleteCommentRecord(input.id);

      if (comment.postId && hasNestedSelection(input.select, 'post')) {
        const post = await drizzleRuntime.fetchById<PostItem>({
          id: comment.postId,
          plan: createNestedExecutionPlan({
            ctx,
            field: 'post',
            input,
            source: postSource,
          }),
        });

        comment.post = post;
      }

      return plan.resolve(comment) as Promise<CommentItem & { post?: { commentCount: number } }>;
    }),

  search: createConnectionProcedure({
    input: z.object({
      query: z.string().min(1, 'Search query is required'),
    }),
    query: async ({ ctx, cursor, direction, input, take }) => {
      const query = input.args?.query?.trim();
      if (!query?.length) {
        return [];
      }

      if (query.length > 1) {
        // Artificial slowdown.
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      return executeSourceConnection({
        ctx,
        cursor,
        direction,
        extra: {
          where: ilike(comment.content, `%${query}%`),
        },
        plan: createExecutionPlan({
          ...input,
          ctx,
          source: commentSource,
        }),
        registry: drizzleRegistry,
        take,
      });
    },
  }),
});
