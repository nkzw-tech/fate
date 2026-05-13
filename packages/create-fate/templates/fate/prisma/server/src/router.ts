import { router } from './trpc/init.ts';
import { commentRouter } from './trpc/routers/comment.ts';
import { postRouter } from './trpc/routers/post.ts';
import { userRouter } from './trpc/routers/user.ts';

export const appRouter = router({
  comment: commentRouter,
  post: postRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;

export * from './trpc/views.ts';
