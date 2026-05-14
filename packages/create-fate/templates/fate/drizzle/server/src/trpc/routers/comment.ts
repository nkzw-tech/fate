import { connectionArgs } from '@nkzw/fate/server';
import type { DrizzleQueryExtra } from '@nkzw/fate/server/drizzle';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  commentSearchWhere,
  createCommentRecord,
  deleteCommentRecord,
  findCommentPostId,
  postExists,
} from '../../drizzle/queries.ts';
import { fate, live, procedure, router } from '../init.ts';
import type { CommentItem } from '../views.ts';
import { commentDataView, postSummaryDataView } from '../views.ts';

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

      if (!(await postExists(input.postId))) {
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

      const result = await fate.resolveById({
        ctx,
        id: commentId,
        input,
        view: commentDataView,
      });
      if (!result) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        });
      }

      live.connection('Post.comments', { id: input.postId }).appendNode('Comment', commentId);
      live.update('Post', input.postId, { changed: ['commentCount', 'comments'] });

      return result as CommentItem & { post?: { commentCount: number } };
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
      const postId = await findCommentPostId(input.id);
      if (!postId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        });
      }

      const deleted = await deleteCommentRecord(input.id);
      if (!deleted) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        });
      }

      const post = await fate.resolveById({
        ctx,
        id: postId,
        input: { args: input.args, select: ['commentCount', 'id'] },
        view: postSummaryDataView,
      });

      live.connection('Post.comments', { id: postId }).deleteEdge('Comment', input.id);
      live.update('Post', postId, { changed: ['commentCount', 'comments'] });

      return {
        id: input.id,
        post,
      } as CommentItem & { post?: { commentCount: number } };
    }),

  search: fate.connection({
    input: z.object({
      query: z.string().min(1, 'Search query is required'),
    }),
    query: async ({ ctx, cursor, direction, input, skip, take }) => {
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
          where: commentSearchWhere(query) as unknown as DrizzleQueryExtra['where'],
        },
        input,
        skip,
        take,
        view: commentDataView,
      });
    },
  }),
});
