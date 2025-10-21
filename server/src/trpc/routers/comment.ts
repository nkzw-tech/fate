import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { CommentFindManyArgs } from '../../prisma/prisma-client/models.ts';
import { prismaSelect } from '../../prisma/prismaSelect.tsx';
import { procedure, router } from '../init.ts';

const authorSelection = {
  select: {
    id: true,
    name: true,
    username: true,
  },
} as const;

const postSelection = {
  select: {
    id: true,
    title: true,
  },
} as const;

const defaultCommentInclude = {
  author: authorSelection,
  post: postSelection,
} as const;

export const commentRouter = router({
  add: procedure
    .input(
      z.object({
        content: z.string().min(1, 'Content is required'),
        postId: z.string().min(1, 'Post id is required'),
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

      return ctx.prisma.comment.create({
        data: {
          authorId: ctx.sessionUser.id,
          content: input.content,
          postId: input.postId,
        },
        include: defaultCommentInclude,
      });
    }),
  byId: procedure
    .input(
      z.object({
        ids: z.array(z.string().min(1)).nonempty(),
        select: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const select = prismaSelect(input.select);
      const comments = await ctx.prisma.comment.findMany({
        where: { id: { in: input.ids } },
        ...(select ? { select } : { include: defaultCommentInclude }),
      } as CommentFindManyArgs);

      const map = new Map(comments.map((comment) => [comment.id, comment]));
      return input.ids.map((id) => map.get(id)).filter(Boolean);
    }),
});
