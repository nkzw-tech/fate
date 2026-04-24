import {
  connectionArgs,
  getNestedSelection,
  getScopedArgs,
  hasNestedSelection,
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
import { fate, procedure, router } from '../init.ts';
import { commentDataView, postDataView } from '../views.ts';

export const commentRouter = router({
  ...fate.procedures({
    list: false,
    view: commentDataView,
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

      const post = await fate.resolveById({
        ctx,
        id: input.postId,
        input: { select: ['id'] },
        view: postDataView,
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

      const comment = await fate.resolveById({
        ctx,
        id: commentId,
        input,
        view: commentDataView,
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
      const plan = fate.createPlan({
        ...input,
        ctx,
        view: commentDataView,
      });

      const comment = await fate.fetchById<CommentItem>({
        ctx,
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
        const post = await fate.fetchById<PostItem>({
          ctx,
          id: comment.postId,
          plan: fate.createPlan({
            args: getScopedArgs(input.args, 'post'),
            ctx,
            select: getNestedSelection(input.select, 'post'),
            view: postDataView,
          }),
        });

        comment.post = post;
      }

      return plan.resolve(comment) as Promise<CommentItem & { post?: { commentCount: number } }>;
    }),

  search: fate.connection({
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

      return fate.resolveConnection({
        ctx,
        cursor,
        direction,
        extra: {
          where: ilike(comment.content, `%${query}%`),
        },
        input,
        take,
        view: commentDataView,
      });
    },
  }),
});
