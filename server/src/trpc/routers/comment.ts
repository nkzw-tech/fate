import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { connectionArgs } from '../../fate-server/connection.ts';
import { createDataViewSelection } from '../../fate-server/dataView.ts';
import type {
  CommentFindManyArgs,
  CommentSelect,
} from '../../prisma/prisma-client/models.ts';
import { procedure, router } from '../init.ts';
import { commentDataView } from '../views.ts';
import type { CommentItem } from '../views.ts';

const postSelection = {
  id: true,
  title: true,
} as const;

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

      const post = await ctx.prisma.post.findUnique({
        where: {
          id: input.postId,
        },
      });

      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found',
        });
      }

      const selection = createDataViewSelection<CommentItem>({
        args: input.args,
        context: ctx,
        paths: input.select,
        view: commentDataView,
      });

      const data = {
        authorId: ctx.sessionUser.id,
        content: input.content,
        postId: input.postId,
      };

      const result = await ctx.prisma.comment.create({
        data,
        select: {
          ...selection.select,
          post: {
            select: {
              ...postSelection,
              ...(selection.select.post as { select?: Record<string, unknown> })
                ?.select,
            },
          },
        } as CommentSelect,
      });
      return selection.resolve(result);
    }),
  byId: procedure
    .input(
      z.object({
        args: connectionArgs,
        ids: z.array(z.string().min(1)).nonempty(),
        select: z.array(z.string()),
      }),
    )
    .query(async ({ ctx, input }) => {
      const selection = createDataViewSelection<CommentItem>({
        args: input.args,
        context: ctx,
        paths: input.select,
        view: commentDataView,
      });
      const comments = await ctx.prisma.comment.findMany({
        select: selection.select,
        where: { id: { in: input.ids } },
      } as CommentFindManyArgs);

      const resolved = await selection.resolveMany(
        comments as Array<CommentItem>,
      );
      const map = new Map(resolved.map((comment) => [comment.id, comment]));
      return input.ids.map((id) => map.get(id)).filter(Boolean);
    }),
  delete: procedure
    .input(
      z.object({
        id: z.string().min(1, 'Comment id is required'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const comment = await ctx.prisma.comment.findUnique({
        select: { authorId: true },
        where: { id: input.id },
      });

      if (!comment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        });
      }

      await ctx.prisma.comment.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),
});
