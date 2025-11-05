import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { PostFindManyArgs } from '../../prisma/prisma-client/models.ts';
import { prismaSelect } from '../../prisma/prismaSelect.tsx';
import { procedure, router } from '../init.ts';

const authorSelection = {
  select: {
    id: true,
    name: true,
    username: true,
  },
} as const;

const commentInclude = {
  author: authorSelection,
} as const;

const categorySelection = {
  select: {
    description: true,
    id: true,
    name: true,
  },
} as const;

const tagSelection = {
  select: {
    description: true,
    id: true,
    name: true,
  },
} as const;

const postInclude = {
  author: authorSelection,
  category: categorySelection,
  comments: {
    include: commentInclude,
    orderBy: {
      createdAt: 'asc',
    },
  },
  tags: tagSelection,
} as const;

export const postRouter = router({
  byId: procedure
    .input(
      z.object({
        ids: z.array(z.string().min(1)).nonempty(),
        select: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const select = prismaSelect(input.select);
      const posts = await ctx.prisma.post.findMany({
        where: { id: { in: input.ids } },
        ...(select ? { select } : { include: postInclude }),
      } as PostFindManyArgs);

      const map = new Map(posts.map((post) => [post.id, post]));
      return input.ids.map((id) => map.get(id)).filter(Boolean);
    }),
  like: procedure
    .input(
      z.object({
        id: z.string().min(1, 'Post id is required.'),
        select: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const post = await ctx.prisma.post.findUnique({
        where: {
          id: input.id,
        },
      });

      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found.',
        });
      }

      const select = prismaSelect(input.select);
      const data = {
        likes: {
          increment: 1,
        },
      } as const;
      const where = { id: input.id };

      if (select) {
        return ctx.prisma.post.update({
          data,
          select,
          where,
        });
      }

      return ctx.prisma.post.update({
        data,
        include: postInclude,
        where,
      });
    }),
  list: procedure
    .input(
      z.object({
        after: z.string().optional(),
        first: z.number().int().positive().optional(),
        select: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const take = (input.first ?? 20) + 1;
      const select = prismaSelect(input.select);
      const findOptions: PostFindManyArgs = {
        orderBy: { createdAt: 'desc' },
        take,
        ...(select ? { select } : { include: postInclude }),
      };
      if (input.after) {
        findOptions.cursor = { id: input.after };
        findOptions.skip = 1;
      }

      const rows = await ctx.prisma.post.findMany(findOptions);
      const hasNext = rows.length > (input.first ?? 20);
      const limited = rows.slice(0, input.first ?? 20);
      return {
        edges: limited.map((node) => ({ cursor: node.id, node })),
        pageInfo: {
          endCursor: limited.length ? limited.at(-1)!.id : undefined,
          hasNextPage: hasNext,
        },
      };
    }),
  unlike: procedure
    .input(
      z.object({
        id: z.string().min(1, 'Post id is required.'),
        select: z.array(z.string()).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.prisma.$transaction(async (tx) => {
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

        const select = prismaSelect(input.select);
        const where = { id: input.id };

        if (existing.likes <= 0) {
          if (select) {
            return tx.post.findUniqueOrThrow({
              select,
              where,
            });
          }

          return tx.post.findUniqueOrThrow({
            include: postInclude,
            where,
          });
        }

        const data = {
          likes: {
            decrement: 1,
          },
        } as const;

        if (select) {
          return tx.post.update({
            data,
            select,
            where,
          });
        }

        return tx.post.update({
          data,
          include: postInclude,
          where,
        });
      }),
    ),
});
