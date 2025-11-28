import { connectionArgs, createResolver } from '@nkzw/fate/server';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type {
  CommentFindManyArgs,
  CommentSelect,
} from '../../prisma/prisma-client/models.ts';
import { createConnectionProcedure } from '../connection.ts';
import { procedure, router } from '../init.ts';
import { commentDataView } from '../views.ts';
import type { CommentItem } from '../views.ts';

const postSelection = {
  id: true,
  title: true,
} as const;

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

      const { resolve, select } = createResolver({
        ...input,
        ctx,
        view: commentDataView,
      });

      return resolve(
        await ctx.prisma.comment.create({
          data: {
            authorId: ctx.sessionUser.id,
            content: input.content,
            postId: input.postId,
          },
          select: getCommentSelection(select),
        }),
      ) as Promise<CommentItem & { post?: { commentCount: number } }>;
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
      const { resolveMany, select } = createResolver({
        ...input,
        ctx,
        view: commentDataView,
      });
      return await resolveMany(
        await ctx.prisma.comment.findMany({
          select,
          where: { id: { in: input.ids } },
        } as CommentFindManyArgs),
      );
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
        select: { authorId: true },
        where: { id: input.id },
      });

      if (!comment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        });
      }

      const { resolve, select } = createResolver({
        ...input,
        ctx,
        view: commentDataView,
      });

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

      return resolve(result) as Promise<
        CommentItem & { post?: { commentCount: number } }
      >;
    }),

  search: createConnectionProcedure({
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

      const { resolveMany, select } = createResolver({
        ...input,
        ctx,
        view: commentDataView,
      });
      const findOptions: CommentFindManyArgs = {
        orderBy: { createdAt: 'desc' },
        select,
        take: direction === 'forward' ? take : -take,
        where: {
          content: {
            contains: query,
            mode: 'insensitive',
          },
        },
      };

      if (cursor) {
        findOptions.cursor = { id: cursor };
        findOptions.skip = skip;
      }

      const items = await ctx.prisma.comment.findMany(findOptions);
      return resolveMany(direction === 'forward' ? items : items.reverse());
    },
  }),
});
