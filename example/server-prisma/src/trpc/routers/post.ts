import { connectionArgs, createSourcePlan, toPrismaSelect } from '@nkzw/fate/server';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type {
  PostFindUniqueArgs,
  PostSelect,
  PostUpdateArgs,
} from '../../prisma/prisma-client/models.ts';
import { procedure, router } from '../init.ts';
import { sourceProcedures } from '../sourceRouter.ts';
import { Post, postSource } from '../views.ts';

export const postRouter = router({
  ...sourceProcedures(postSource),
  add: procedure
    .input(
      z.object({
        args: connectionArgs,
        content: z.string().min(1, 'Content is required'),
        select: z.array(z.string()),
        title: z.string().min(1, 'Title is required'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.sessionUser) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'You must be logged in to add a comment',
        });
      }

      const plan = createSourcePlan({
        ...input,
        ctx,
        source: postSource,
      });
      const select = toPrismaSelect(plan);

      return (await plan.resolve(
        await ctx.prisma.post.create({
          data: {
            authorId: ctx.sessionUser.id,
            content: input.content,
            title: input.title,
          },
          select: select as PostSelect,
        }),
      )) as Post;
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

      const plan = createSourcePlan({
        ...input,
        ctx,
        source: postSource,
      });
      const select = toPrismaSelect(plan);

      return (await plan.resolve(
        await ctx.prisma.post.update({
          data: {
            likes: {
              increment: 1,
            },
          },
          select,
          where: { id: input.id },
        } as PostUpdateArgs),
      )) as Post;
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
        const plan = createSourcePlan({
          ...input,
          ctx,
          source: postSource,
        });
        const select = toPrismaSelect(plan);
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
          return (await plan.resolve(
            await tx.post.findUniqueOrThrow({
              select,
              where: { id: input.id },
            } as PostFindUniqueArgs),
          )) as Post;
        }

        return (await plan.resolve(
          await tx.post.update({
            data: {
              likes: {
                decrement: 1,
              },
            },
            select,
            where: { id: input.id },
          } as PostUpdateArgs),
        )) as Post;
      }),
    ),
});
