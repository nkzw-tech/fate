import {
  connectionArgs,
  createSourcePlan,
  resolveSourceConnection,
  refetchSourceById,
} from '@nkzw/fate/server';
import { TRPCError } from '@trpc/server';
import { ilike } from 'drizzle-orm';
import { z } from 'zod';
import {
  type CommentItem,
  type PostItem,
  createCommentRecord,
  deleteCommentRecord,
} from '../../drizzle/queries.ts';
import { comment } from '../../drizzle/schema.ts';
import { drizzleRegistry, drizzleAdapter } from '../executor.ts';
import { procedure, router } from '../init.ts';
import { createConnectionProcedure, sourceProcedures } from '../sourceRouter.ts';
import { commentSource, postSource } from '../views.ts';

type AnyRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is AnyRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasNestedSelection = (select: Iterable<string>, field: string) => {
  for (const path of select) {
    if (path === field || path.startsWith(`${field}.`)) {
      return true;
    }
  }
  return false;
};

const getNestedSelection = (select: Iterable<string>, field: string): Array<string> => {
  const nested: Array<string> = [];
  for (const path of select) {
    if (path.startsWith(`${field}.`)) {
      nested.push(path.slice(field.length + 1));
    }
  }
  return nested;
};

const getScopedArgs = (args: AnyRecord | undefined, path: string): AnyRecord | undefined => {
  if (!args) {
    return undefined;
  }

  let current: unknown = args;
  for (const segment of path.split('.')) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }

  return isRecord(current) ? current : undefined;
};

export const commentRouter = router({
  ...sourceProcedures({
    list: false,
    source: commentSource,
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

      const post = await refetchSourceById({
        ctx,
        id: input.postId,
        input: { select: ['id'] },
        registry: drizzleRegistry,
        source: postSource,
      });

      if (!post) {
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

      const comment = await refetchSourceById({
        ctx,
        id: commentId,
        input,
        registry: drizzleRegistry,
        source: commentSource,
      });
      if (!comment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        });
      }

      return comment as CommentItem & { post?: { commentCount: number } };
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
      const plan = createSourcePlan({
        ...input,
        ctx,
        source: commentSource,
      });

      const comment = await drizzleAdapter.fetchById<CommentItem>({
        ctx,
        extra: { extraFields: ['authorId', 'postId'] },
        id: input.id,
        plan,
      });

      if (!comment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        });
      }

      if (comment.authorId && comment.authorId !== ctx.sessionUser?.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only delete your own comments.',
        });
      }

      await deleteCommentRecord(input.id);

      if (comment.postId && hasNestedSelection(input.select, 'post')) {
        const post = await drizzleAdapter.fetchById<PostItem>({
          ctx,
          id: comment.postId,
          plan: createSourcePlan({
            args: getScopedArgs(input.args, 'post'),
            ctx,
            select: getNestedSelection(input.select, 'post'),
            source: postSource,
          }),
        });

        comment.post = post;
      }

      return plan.resolve(comment) as Promise<CommentItem & { post?: { commentCount: number } }>;
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

      return resolveSourceConnection({
        ctx,
        cursor,
        direction,
        extra: {
          where: ilike(comment.content, `%${query}%`),
        },
        input,
        registry: drizzleRegistry,
        source: commentSource,
        take,
      });
    },
  }),
});
