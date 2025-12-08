import { connectionArgs, createResolver } from '@nkzw/fate/server';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { PostFindManyArgs } from '../../prisma/prisma-client/models.ts';
import { createConnectionProcedure } from '../connection.ts';
import { procedure, router } from '../init.ts';
import { Post, postDataView, PostItem } from '../views.ts';

export const postRouter = router({
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
        view: postDataView,
      });
      return resolveMany(
        await ctx.prisma.post.findMany({
          select,
          where: { id: { in: input.ids } },
        } as PostFindManyArgs),
      );
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

      const existing = await ctx.prisma.post.findUnique({
        where: {
          id: input.id,
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found.',
        });
      }

      const { resolve, select } = createResolver({
        ...input,
        ctx,
        view: postDataView,
      });

      const updated = await ctx.prisma.post.update({
        data: {
          likes: {
            increment: 1,
          },
        },
        select,
        where: { id: input.id },
      });
      return (await resolve(updated as unknown as PostItem)) as Post;
    }),
  list: createConnectionProcedure({
    query: async ({ ctx, cursor, direction, input, skip, take }) => {
      const { resolveMany, select } = createResolver({
        ...input,
        ctx,
        view: postDataView,
      });
      const findOptions: PostFindManyArgs = {
        orderBy: { createdAt: 'desc' },
        select,
        take: direction === 'forward' ? take : -take,
      };

      if (cursor) {
        findOptions.cursor = { id: cursor };
        findOptions.skip = skip;
      }

      const items = await ctx.prisma.post.findMany(findOptions);
      return resolveMany(direction === 'forward' ? items : items.reverse());
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
    .mutation(({ ctx, input }) =>
      ctx.prisma.$transaction(async (tx) => {
        const { resolve, select } = createResolver({
          ...input,
          ctx,
          view: postDataView,
        });
        const existing = await tx.post.findUnique({
          select: {
            likes: true,
          },
          where: {
            id: input.id,
          },
        });

        if (!existing) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Post not found',
          });
        }

        if (existing.likes <= 0) {
          const result = await tx.post.findUniqueOrThrow({
            select,
            where: { id: input.id },
          });
          return resolve(result as unknown as PostItem);
        }

        const updated = await tx.post.update({
          data: {
            likes: {
              decrement: 1,
            },
          },
          select,
          where: { id: input.id },
        });
        return (await resolve(updated as unknown as PostItem)) as Post;
      }),
    ),
});
