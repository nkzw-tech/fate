import { byIdInput, connectionArgs, createResolver } from '@nkzw/fate/server';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  type CommentItem,
  createCommentRecord,
  deleteCommentRecord,
  getCommentById,
  getCommentsByIds,
  getPostById,
  searchCommentsConnection,
} from '../../drizzle/queries.ts';
import { createConnectionProcedure } from '../connection.ts';
import { procedure, router } from '../init.ts';
import { commentDataView } from '../views.ts';

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

      const post = await getPostById(input.postId);

      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found',
        });
      }

      const { resolve } = createResolver({
        ...input,
        ctx,
        view: commentDataView,
      });

      const comment = await createCommentRecord({
        authorId: ctx.sessionUser.id,
        content: input.content,
        postId: input.postId,
      });

      if (!comment) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create comment.',
        });
      }

      return resolve(comment) as Promise<CommentItem & { post?: { commentCount: number } }>;
    }),
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    const { resolveMany } = createResolver({
      ...input,
      ctx,
      view: commentDataView,
    });
    return resolveMany(await getCommentsByIds(input.ids));
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
      const comment = await getCommentById(input.id);

      if (!comment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        });
      }

      const { resolve } = createResolver({
        ...input,
        ctx,
        view: commentDataView,
      });

      if (comment.authorId && comment.authorId !== ctx.sessionUser?.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only delete your own comments.',
        });
      }

      const result = await deleteCommentRecord(input.id);
      if (!result) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        });
      }

      return resolve(result) as Promise<CommentItem & { post?: { commentCount: number } }>;
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

      const { resolveMany } = createResolver({
        ...input,
        ctx,
        view: commentDataView,
      });
      const items = await searchCommentsConnection({ cursor, direction, query, take });
      return resolveMany(items);
    },
  }),
});
