import {
  createFateServer,
  createSourcePlan,
  FateRequestError,
  getNestedSelection,
  getScopedArgs,
  hasNestedSelection,
} from '@nkzw/fate/server';
import { createDrizzleSourceAdapter, type DrizzleQueryExtra } from '@nkzw/fate/server/drizzle';
import { createVoidFateLive } from 'void-fate/server';
import { db, eq, like } from 'void/db';
import { z } from 'zod';
import {
  type CommentItem,
  type PostItem,
  createCommentRecord,
  createPostRecord,
  deleteCommentRecord,
  likePostRecord,
  unlikePostRecord,
} from '../../db/queries.ts';
import schema, { comment, user as userTable } from '../../db/schema.ts';
import { assertCanDeleteComment, getCommentDeleteFetchSelection } from './commentPermissions.ts';
import { createContext, type AppContext } from './context.ts';
import { commentDataView, postDataView, Root, userDataView, type Post } from './views.ts';

type ResolverOptions<Input> = {
  ctx: AppContext;
  input: Input;
  select: Array<string>;
};

type ListResolverOptions = ResolverOptions<{
  args?: Record<string, unknown>;
}>;

const source = createDrizzleSourceAdapter<AppContext>({
  db,
  schema,
  views: Root,
});
export const fateLive = createVoidFateLive();
export const { live } = fateLive;

const requireUser = (ctx: AppContext) => {
  if (!ctx.sessionUser) {
    throw new FateRequestError('UNAUTHORIZED', 'You must be logged in.');
  }

  return ctx.sessionUser;
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
            where: like(
              comment.content,
              `%${query.trim()}%`,
            ) as unknown as DrizzleQueryExtra['where'],
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
  live,
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
        const post = await source.resolveById({
          ctx,
          id: input.postId,
          input: { select: ['id'] },
          view: postDataView,
        });

        if (!post) {
          throw new Error('Post not found.');
        }

        const commentId = await createCommentRecord({
          authorId: user.id,
          content: input.content,
          postId: input.postId,
        });

        if (!commentId) {
          throw new Error('Failed to create comment.');
        }

        const created = (await source.resolveById({
          ctx,
          id: commentId,
          input: {
            select: select.filter((field) => field !== 'post' && !field.startsWith('post.')),
          },
          view: commentDataView,
        })) as (CommentItem & { post?: PostItem | null }) | null;

        if (!created) {
          throw new Error('Comment not found.');
        }

        const liveComment = await source.resolveById({
          ctx,
          id: commentId,
          input: {
            select: ['author.id', 'author.name', 'author.username', 'content', 'id'],
          },
          view: commentDataView,
        });

        if (hasNestedSelection(select, 'post')) {
          created.post = (await source.resolveById<PostItem>({
            ctx,
            id: input.postId,
            input: {
              args: getScopedArgs(undefined, 'post'),
              select: getNestedSelection(select, 'post'),
            },
            view: postDataView,
          })) as PostItem | null;
        }

        live
          .connection('Post.comments', { id: input.postId })
          .appendNode('Comment', commentId, { node: liveComment ?? created });
        live.update('Post', input.postId);

        return created as CommentItem & { post?: { commentCount: number } };
      },
      type: 'Comment',
    },
    'comment.delete': {
      input: z.object({
        id: z.string().min(1, 'Comment id is required'),
      }),
      resolve: async ({ ctx, input, select }: ResolverOptions<{ id: string }>) => {
        const plan = createSourcePlan({
          ctx,
          select,
          source: source.getSource(commentDataView),
        });
        const commentSelection = getCommentDeleteFetchSelection(select);

        const existing = await source.fetchById<CommentItem>({
          ctx,
          extra: { extraFields: ['authorId', 'postId'] },
          id: input.id,
          plan: createSourcePlan({
            ctx,
            select: commentSelection,
            source: source.getSource(commentDataView),
          }),
        });

        if (!existing) {
          throw new FateRequestError('NOT_FOUND', 'Comment not found.');
        }

        assertCanDeleteComment(existing, ctx.sessionUser);

        await deleteCommentRecord(input.id);

        if (existing.postId && hasNestedSelection(select, 'post')) {
          const post = await source.fetchById<PostItem>({
            ctx,
            id: existing.postId,
            plan: createSourcePlan({
              args: getScopedArgs(undefined, 'post'),
              ctx,
              select: getNestedSelection(select, 'post'),
              source: source.getSource(postDataView),
            }),
          });

          existing.post = post;
        }

        const resolved = (await plan.resolve(existing)) as CommentItem & {
          post?: { commentCount: number };
        };

        if (existing.postId) {
          live.connection('Post.comments', { id: existing.postId }).deleteEdge('Comment', input.id);
          live.update('Post', existing.postId);
        }

        return resolved;
      },
      type: 'Comment',
    },
    'post.add': {
      input: z.object({
        content: z.string().min(1, 'Content is required'),
        title: z.string().min(1, 'Title is required'),
      }),
      resolve: async ({
        ctx,
        input,
        select,
      }: ResolverOptions<{ content: string; title: string }>) => {
        const user = requireUser(ctx);
        const postId = await createPostRecord({
          authorId: user.id,
          content: input.content,
          title: input.title,
        });

        if (!postId) {
          throw new Error('Failed to create post.');
        }

        const post = await source.resolveById({
          ctx,
          id: postId,
          input: { select },
          view: postDataView,
        });

        if (!post) {
          throw new Error('Post not found.');
        }

        live.connection('posts').prependNode('Post', postId);

        return post as Post;
      },
      type: 'Post',
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
          throw new Error('Simulated error.');
        } else if (input.error === 'callSite') {
          await new Promise((resolve) => setTimeout(resolve, 200));
          throw new Error('Gotta pay up.');
        }

        const updated = await likePostRecord(input.id);
        if (!updated) {
          throw new Error('Post not found.');
        }

        const post = await source.resolveById({
          ctx,
          id: input.id,
          input: { select },
          view: postDataView,
        });

        if (!post) {
          throw new Error('Post not found.');
        }

        live.update('Post', input.id, { data: post });

        return post as Post;
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
          throw new Error('Post not found.');
        }

        const post = await source.resolveById({
          ctx,
          id: input.id,
          input: { select },
          view: postDataView,
        });

        if (!post) {
          throw new Error('Post not found.');
        }

        live.update('Post', input.id, { data: post });

        return post as Post;
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

        await db
          .update(userTable)
          .set({ name: input.name, updatedAt: new Date() })
          .where(eq(userTable.id, user.id));

        const updated = await source.resolveById({
          ctx,
          id: user.id,
          input: { select },
          view: userDataView,
        });

        if (!updated) {
          throw new Error('User not found.');
        }

        return updated;
      },
      type: 'User',
    },
  },
  queries: {
    viewer: {
      resolve: ({ ctx, select }: Omit<ResolverOptions<unknown>, 'input'>) =>
        ctx.sessionUser
          ? source.resolveById({
              ctx,
              id: ctx.sessionUser.id,
              input: { select },
              view: Root.viewer,
            })
          : null,
      type: 'User',
    },
  },
  roots: Root,
  sources: source,
});

export * from './views.ts';
