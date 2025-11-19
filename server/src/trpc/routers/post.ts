import {
  arrayToConnection,
  connectionArgs,
  createDataViewSelection,
  scopedArgsForPath,
} from '@nkzw/fate/server';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { PostFindManyArgs } from '../../prisma/prisma-client/models.ts';
import { createConnectionProcedure } from '../connection.ts';
import { procedure, router } from '../init.ts';
import { postDataView, PostItem } from '../views.ts';

const transformPost = (
  { comments, tags, ...post }: PostItem,
  args?: Record<string, unknown>,
) => ({
  ...post,
  comments: arrayToConnection(comments, {
    args: scopedArgsForPath(args, 'comments'),
  }),
  tags: arrayToConnection(tags, {
    args: scopedArgsForPath(args, 'tags'),
  }),
});

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
      const selection = createDataViewSelection<PostItem>({
        args: input.args,
        context: ctx,
        paths: input.select,
        view: postDataView,
      });
      const posts = await ctx.prisma.post.findMany({
        select: selection.select,
        where: { id: { in: input.ids } },
      } as PostFindManyArgs);
      const resolved = await selection.resolveMany(posts as Array<PostItem>);
      const map = new Map(
        resolved.map((post) => {
          const result = transformPost(post, input.args);
          return [result.id, result];
        }),
      );
      return input.ids.map((id) => map.get(id)).filter(Boolean);
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

      const selection = createDataViewSelection<PostItem>({
        args: input.args,
        context: ctx,
        paths: input.select,
        view: postDataView,
      });

      const updated = await ctx.prisma.post.update({
        data: {
          likes: {
            increment: 1,
          },
        },
        select: selection.select,
        where: { id: input.id },
      });
      const resolved = await selection.resolve(updated as unknown as PostItem);
      return transformPost(resolved, input.args);
    }),
  list: createConnectionProcedure({
    map: ({ input, items }) =>
      (items as Array<PostItem>).map((post) => transformPost(post, input.args)),
    query: async ({ ctx, cursor, direction, input, skip, take }) => {
      const selection = createDataViewSelection<PostItem>({
        args: input.args,
        context: ctx,
        paths: input.select,
        view: postDataView,
      });
      const findOptions: PostFindManyArgs = {
        orderBy: { createdAt: 'desc' },
        select: selection.select,
        take: direction === 'forward' ? take : -take,
      };

      if (cursor) {
        findOptions.cursor = { id: cursor };
        findOptions.skip = skip;
      }

      const items = await ctx.prisma.post.findMany(findOptions);
      return selection.resolveMany(
        direction === 'forward' ? items : items.reverse(),
      );
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
        const selection = createDataViewSelection<PostItem>({
          args: input.args,
          context: ctx,
          paths: input.select,
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
            select: selection.select,
            where: { id: input.id },
          });
          const resolved = await selection.resolve(
            result as unknown as PostItem,
          );
          return transformPost(resolved, input.args);
        }

        const updated = await tx.post.update({
          data: {
            likes: {
              decrement: 1,
            },
          },
          select: selection.select,
          where: { id: input.id },
        });
        const resolved = await selection.resolve(
          updated as unknown as PostItem,
        );
        return transformPost(resolved, input.args);
      }),
    ),
});
