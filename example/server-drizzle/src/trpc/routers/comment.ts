import {
  byIdInput,
  connectionArgs,
  createExecutionPlan,
  executeSourceById,
  executeSourceByIds,
} from '@nkzw/fate/server';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  type CommentItem,
  createCommentRecord,
  deleteCommentRecord,
  fetchCommentById,
  fetchPostById,
  searchCommentsConnection,
} from '../../drizzle/queries.ts';
import { createConnectionProcedure } from '../connection.ts';
import { drizzleRegistry } from '../executor.ts';
import { procedure, router } from '../init.ts';
import { commentSource, postSource } from '../views.ts';

const hasNestedSelection = (select: Array<string>, field: string) =>
  select.some((path) => path === field || path.startsWith(`${field}.`));

const getNestedSelection = (select: Array<string>, field: string) =>
  select.flatMap((path) => {
    if (path === field) {
      return [];
    }

    return path.startsWith(`${field}.`) ? [path.slice(field.length + 1)] : [];
  });

const getNestedArgs = (args: unknown, field: string): Record<string, unknown> | undefined => {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return undefined;
  }

  const value = (args as Record<string, unknown>)[field];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
};

export const commentRouter = router({
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

      const post = await executeSourceById({
        ctx,
        id: input.postId,
        plan: createExecutionPlan({
          ctx,
          select: ['id'],
          source: postSource,
        }),
        registry: drizzleRegistry,
      });

      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found',
        });
      }

      const plan = createExecutionPlan({
        ...input,
        ctx,
        source: commentSource,
      });

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

      const comment = await executeSourceById({
        ctx,
        id: commentId,
        plan,
        registry: drizzleRegistry,
      });
      if (!comment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        });
      }

      return comment as CommentItem & { post?: { commentCount: number } };
    }),
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) =>
    executeSourceByIds({
      ctx,
      ids: input.ids,
      plan: createExecutionPlan({ ...input, ctx, source: commentSource }),
      registry: drizzleRegistry,
    }),
  ),
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

      const comment = await fetchCommentById(input.id, plan.root);

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
        const post = await fetchPostById(
          comment.postId,
          createExecutionPlan({
            args: getNestedArgs(input.args, 'post'),
            ctx,
            select: getNestedSelection(input.select, 'post'),
            source: postSource,
          }).root,
        );

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

      const plan = createExecutionPlan({
        ...input,
        ctx,
        source: commentSource,
      });
      return plan.resolveMany(
        await searchCommentsConnection({ cursor, direction, node: plan.root, query, take }),
      );
    },
  }),
});
