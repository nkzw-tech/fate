import { connectionArgs, toPrismaSelect } from '@nkzw/fate/server';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { CommentSelect } from '../../prisma/prisma-client/models.ts';
import { fate, live, procedure, router } from '../init.ts';
import type { CommentItem } from '../views.ts';
import { commentDataView } from '../views.ts';

const postSelection = {
  id: true,
  title: true,
};

const getCommentSelection = (select: Record<string, unknown>) => {
  return {
    ...select,
    post: {
      select: {
        ...postSelection,
        ...(select.post as { select?: Record<string, unknown> })?.select,
      },
    },
  } as CommentSelect;
};

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

      const plan = fate.createPlan({
        ...input,
        ctx,
        view: commentDataView,
      });
      const select = toPrismaSelect(plan);

      const comment = (await plan.resolve(
        await ctx.prisma.comment.create({
          data: {
            authorId: ctx.sessionUser.id,
            content: input.content,
            postId: input.postId,
          },
          select: getCommentSelection(select),
        }),
      )) as CommentItem & { post?: { commentCount: number } };

      live.connection('Post.comments', { id: input.postId }).appendNode('Comment', comment.id);
      live.update('Post', input.postId);

      return comment;
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
      const comment = await ctx.prisma.comment.findUnique({
        select: { authorId: true, postId: true },
        where: { id: input.id },
      });

      if (!comment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        });
      }

      const plan = fate.createPlan({
        ...input,
        ctx,
        view: commentDataView,
      });
      const select = toPrismaSelect(plan);

      let result = (await ctx.prisma.comment.delete({
        select: getCommentSelection(select),
        where: { id: input.id },
      })) as CommentItem & { post?: { _count?: { comments: number } } };

      if (result.post?._count) {
        result = {
          ...result,
          post: {
            ...result.post,
            _count: {
              comments: result.post._count.comments - 1,
            },
          },
        };
      }

      const resolved = (await plan.resolve(result)) as CommentItem & {
        post?: { commentCount: number };
      };

      live.connection('Post.comments', { id: comment.postId }).deleteEdge('Comment', input.id);
      live.update('Post', comment.postId);

      return resolved;
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
          where: {
            content: {
              contains: query,
              mode: 'insensitive',
            },
          },
        },
        input,
        skip,
        take,
        view: commentDataView,
      });
    },
  }),
});
