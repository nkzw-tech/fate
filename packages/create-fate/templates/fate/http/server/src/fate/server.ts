import { createFateServer, FateRequestError } from '@nkzw/fate/server';
import { createDrizzleSourceAdapter, type DrizzleQueryExtra } from '@nkzw/fate/server/drizzle';
import { z } from 'zod';
import db from '../drizzle/db.ts';
import {
  commentSearchWhere,
  createCommentRecord,
  deleteCommentRecord,
  findCommentPostId,
  likePostRecord,
  postExists,
  unlikePostRecord,
} from '../drizzle/queries.ts';
import schema from '../drizzle/schema.ts';
import { auth } from '../lib/auth.ts';
import { createContext, type AppContext } from './context.ts';
import type { CommentItem } from './views.ts';
import { commentDataView, postDataView, postSummaryDataView, Root, userDataView } from './views.ts';

type ResolverOptions<Input> = {
  ctx: AppContext;
  input: Input;
  select: Array<string>;
};

type ListResolverOptions = ResolverOptions<{
  args?: Record<string, unknown>;
}>;

type QueryResolverOptions = ResolverOptions<{
  args?: Record<string, unknown>;
}>;

const source = createDrizzleSourceAdapter<AppContext>({
  db,
  schema,
  views: Root,
});

const requireUser = (ctx: AppContext) => {
  if (!ctx.sessionUser) {
    throw new FateRequestError('UNAUTHORIZED', 'You must be logged in.');
  }

  return ctx.sessionUser;
};

const resolvePost = async ({
  ctx,
  id,
  select,
}: {
  ctx: AppContext;
  id: string;
  select: Array<string>;
}) => {
  const post = await source.resolveById({
    ctx,
    id,
    input: { select },
    view: postDataView,
  });

  if (!post) {
    throw new FateRequestError('NOT_FOUND', 'Post not found.');
  }

  return post;
};

export const fateServer = createFateServer({
  context: ({ request }) => createContext({ request }),
  lists: {
    commentSearch: {
      resolve: async ({ ctx, input, select }: ListResolverOptions) => {
        const query = input.args?.query;
        if (typeof query !== 'string' || !query.trim().length) {
          return {
            items: [],
            pagination: { hasNext: false, hasPrevious: false },
          };
        }

        if (query.trim().length > 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        const first = typeof input.args?.first === 'number' ? input.args.first : 20;
        const cursor = typeof input.args?.after === 'string' ? input.args.after : undefined;
        const nodes = await source.resolveConnection({
          ctx,
          cursor,
          direction: 'forward',
          extra: {
            where: commentSearchWhere(query) as unknown as DrizzleQueryExtra['where'],
          },
          input: { args: input.args, select },
          skip: cursor ? 1 : undefined,
          take: first + 1,
          view: commentDataView,
        });
        const hasNext = nodes.length > first;
        const items = nodes.slice(0, first).map((node) => ({
          cursor: String(node.id),
          node,
        }));

        return {
          items,
          pagination: {
            hasNext,
            hasPrevious: Boolean(cursor),
            nextCursor: items.at(-1)?.cursor,
            previousCursor: cursor ? items[0]?.cursor : undefined,
          },
        };
      },
      type: 'Comment',
    },
  },
  mutations: {
    'comment.add': {
      input: z.object({
        content: z.string().min(1, 'Content is required'),
        postId: z.string().min(1, 'Post id is required'),
      }),
      resolve: async ({
        ctx,
        input,
        select,
      }: ResolverOptions<{ content: string; postId: string }>) => {
        const user = requireUser(ctx);
        if (!(await postExists(input.postId))) {
          throw new FateRequestError('NOT_FOUND', 'Post not found.');
        }

        const commentId = await createCommentRecord({
          authorId: user.id,
          content: input.content,
          postId: input.postId,
        });

        if (!commentId) {
          throw new FateRequestError('INTERNAL_ERROR', 'Failed to create comment.');
        }

        const result = await source.resolveById({
          ctx,
          id: commentId,
          input: { select },
          view: commentDataView,
        });
        if (!result) {
          throw new FateRequestError('NOT_FOUND', 'Comment not found.');
        }

        return result as CommentItem & { post?: { commentCount: number } };
      },
      type: 'Comment',
    },
    'comment.delete': {
      input: z.object({
        id: z.string().min(1, 'Comment id is required'),
      }),
      resolve: async ({ ctx, input }: ResolverOptions<{ id: string }>) => {
        const postId = await findCommentPostId(input.id);
        if (!postId) {
          throw new FateRequestError('NOT_FOUND', 'Comment not found.');
        }

        const deleted = await deleteCommentRecord(input.id);
        if (!deleted) {
          throw new FateRequestError('NOT_FOUND', 'Comment not found.');
        }

        const post = await source.resolveById({
          ctx,
          id: postId,
          input: { select: ['commentCount', 'id'] },
          view: postSummaryDataView,
        });

        return {
          id: input.id,
          post,
        } as CommentItem & { post?: { commentCount: number } };
      },
      type: 'Comment',
    },
    'post.like': {
      input: z.object({
        error: z.enum(['boundary', 'callSite']).optional(),
        id: z.string().min(1, 'Post id is required.'),
        slow: z.boolean().optional(),
      }),
      resolve: async ({
        ctx,
        input,
        select,
      }: ResolverOptions<{ error?: 'boundary' | 'callSite'; id: string; slow?: boolean }>) => {
        if (input.slow) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        if (input.error === 'boundary') {
          throw new FateRequestError('INTERNAL_ERROR', 'Simulated error.');
        } else if (input.error === 'callSite') {
          await new Promise((resolve) => setTimeout(resolve, 200));
          throw new FateRequestError('INTERNAL_ERROR', 'Gotta pay up.');
        }

        const updated = await likePostRecord(input.id);
        if (!updated) {
          throw new FateRequestError('NOT_FOUND', 'Post not found.');
        }

        return resolvePost({ ctx, id: input.id, select });
      },
      type: 'Post',
    },
    'post.unlike': {
      input: z.object({
        id: z.string().min(1, 'Post id is required.'),
      }),
      resolve: async ({ ctx, input, select }: ResolverOptions<{ id: string }>) => {
        const updated = await unlikePostRecord(input.id);
        if (!updated) {
          throw new FateRequestError('NOT_FOUND', 'Post not found.');
        }

        return resolvePost({ ctx, id: input.id, select });
      },
      type: 'Post',
    },
    'user.update': {
      input: z.object({
        name: z
          .string()
          .trim()
          .min(2, 'Name must be at least 2 characters.')
          .max(50, 'Name must be at most 32 characters.'),
      }),
      resolve: async ({ ctx, input, select }: ResolverOptions<{ name: string }>) => {
        const user = requireUser(ctx);

        await auth.api.updateUser({
          body: { name: input.name },
          headers: ctx.headers,
        });

        const result = await source.resolveById({
          ctx,
          id: user.id,
          input: { select },
          view: userDataView,
        });
        if (!result) {
          throw new FateRequestError('NOT_FOUND', 'User not found.');
        }

        return result;
      },
      type: 'User',
    },
  },
  queries: {
    viewer: {
      resolve: async ({ ctx, select }: QueryResolverOptions) => {
        if (!ctx.sessionUser) {
          return null;
        }

        return source.resolveById({
          ctx,
          id: ctx.sessionUser.id,
          input: { select },
          view: userDataView,
        });
      },
      type: 'User',
    },
  },
  roots: Root,
  sources: source,
});
