import { router } from './init.ts';
import { commentRouter } from './routers/comment.ts';
import { postRouter } from './routers/post.ts';

export const appRouter = router({
  comment: commentRouter,
  post: postRouter,
});

export type AppRouter = typeof appRouter;
