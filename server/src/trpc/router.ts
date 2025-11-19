import { router } from './init.ts';
import { categoryRouter } from './routers/category.ts';
import { commentRouter } from './routers/comment.ts';
import { eventRouter } from './routers/event.ts';
import { postRouter } from './routers/post.ts';
import { projectRouter } from './routers/project.ts';
import { tagRouter } from './routers/tag.ts';
import { userRouter } from './routers/user.ts';

export const appRouter = router({
  category: categoryRouter,
  comment: commentRouter,
  event: eventRouter,
  post: postRouter,
  project: projectRouter,
  tags: tagRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;

export * from './views.ts';
