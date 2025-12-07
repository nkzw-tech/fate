# Server Integration

Until now, we have focused on the client-side API of fate. You'll need a tRPC backend that follows some conventions so you can generate a typed client using fate's CLI. At the moment _fate_ is designed to work with tRPC and Prisma, but the framework is not coupled to any particular ORM or database, it's just what we are starting with.

## Conventions & Object Identity

fate expects that data is served by a tRPC backend that follows these conventions:

- A `byId` query for each data type to fetch individual objects by their unique identifier (`id`).
- A `list` query for fetching lists of objects with support for pagination.

Objects are identified by their ID and type name (`__typename`, e.g. `Post`, `User`), and stored by `__typename:id` (e.g. "Post:123") in the client cache. fate keeps list orderings under stable keys derived from the backend procedure and args. Relations are stored as IDs and returned to components as ViewRef tokens.

fate's type definitions might seem verbose at first glance. However, with fate's minimal API surface, AI tools can easily generate this code for you. For example, fate has a minimal CLI that generates types for the client, but you can also let your LLM write it by hand if you prefer.

> [!NOTE]
> You can adopt _fate_ incrementally in an existing tRPC codebase without changing your existing schema by adding these queries alongside your existing procedures.

## Data Views

To continue with our client example, let's assume we have a `post.ts` file with a tRPC router that exposes a `byId` query for selecting objects by id, and a root `list` query to fetch a list of posts.

Since clients can send arbitrary selection objects to the server, we need to implement a way to translate these selection objects into database queries without exposing raw database queries and private data to the client. On the client, we define views to select fields on each type. We can do the same on the server using fate data views and the `dataView` function from `@nkzw/fate/server`.

Create a `views.ts` file next to your root tRPC router that exports the data views for each type. Here is how you can define a `User` data view for Prisma's `User` model:

```tsx
import { dataView, type Entity } from '@nkzw/fate/server';
import type { User as PrismaUser } from '../prisma/prisma-client/client.ts';

export const userDataView = dataView<PrismaUser>('User')({
  id: true,
  name: true,
  username: true,
});

export type User = Entity<typeof userDataView, 'User'>;
```

_Note: Currently, fate provides helpers to integrate with Prisma, but the framework is not coupled to any particular ORM or database. We hope to provide more direct integrations in the future, and are always open to contributions._

## tRPC Router Implementation

We can apply the above data view in our tRPC router and resolve the client's selection against it using `createResolver`. Here is an example implementation of the `byId` query for the `User` type which allows fetching multiple users by `id`:

```tsx
import { connectionArgs, createResolver } from '@nkzw/fate/server';
import { z } from 'zod';
import type { UserFindManyArgs } from '../../prisma/prisma-client/models.ts';
import { procedure, router } from '../init.ts';
import { userDataView } from '../views.ts';

export const userRouter = router({
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
        view: userDataView,
      });

      const users = await ctx.prisma.user.findMany({
        select: select,
        where: { id: { in: input.ids } },
      } as UserFindManyArgs);

      return await resolveMany(users);
    }),
});
```

Now that we apply `userDataView` to the `byId` query, the server limits the selection to the fields defined in the data view, keeping private fields hidden from the client, and providing type safety for client views:

```tsx
const UserData = view<User>()({
  // Type-error + ignored during runtime.
  password: true,
});
```

## tRPC List Implementation

To implement the `list` query for fetching a paginated list of posts, we can use fate's `createConnectionProcedure` helper. This helper simplifies the implementation of pagination. Here is an example implementation of the `postRouter` with a `list` query:

```tsx
import { createResolver } from '@nkzw/fate/server';
import type { PostFindManyArgs } from '../../prisma/prisma-client/models.ts';
import { createConnectionProcedure } from '../connection.ts';
import { router } from '../init.ts';
import { postDataView } from '../views.ts';

export const postRouter = router({
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
});
```

## Data View Composition

Similar to client-side views, data views can be composed of other data views:

```tsx
export const postDataView = dataView<PostItem>('Post')({
  author: userDataView,
  content: true,
  id: true,
  title: true,
} as const;
```

## Data View Lists

Use the `list` helper to define list fields:

```tsx
import { list } from '@nkzw/fate/server';

export const commentDataView = dataView<CommentItem>('Comment')({
  content: true,
  id: true,
});

export const postDataView = dataView<PostItem>('Post')({
  author: userDataView,
  comments: list(commentDataView),
});
```

We can also define root-level lists by exporting a `Lists` object from our `views.ts` file:

```tsx
export const Lists = {
  posts: postDataView,
};
```

This makes it possible to fetch a list of posts from the client using `useRequest`.

### Custom Root Lists

You might want to define custom root lists that don't directly map to a single data view. For example, a search endpoint that returns a list of posts based on a search query:

```tsx
export const Lists = {
  // …
  postSearch: { procedure: 'search', view: postDataView },
  // …
};
```

This maps the `postSearch` list to a `search` procedure on your post router.

## Data View Resolvers

fate data views support resolvers for computed fields. If we want to add a `commentCount` field to our `Post` data view, we can use the `resolver` helper that defines a Prisma selection for the database query together with a `resolve` function:

```tsx
export const postDataView = dataView<PostItem>('Post')({
  author: userDataView,
  commentCount: resolver<PostItem>({
    resolve: ({ item }) => item._count?.comments ?? 0,
    select: () => ({
      _count: { select: { comments: true } },
    }),
  }),
  comments: list(commentDataView),
  id: true,
} as const;
```

This definition makes the `commentCount` field available to your client-side views.

## Generating a typed client

Now that we have defined our client views and our tRPC server, we need to connect them with some glue code. We recommend using fate's CLI for convenience.

First, make sure our tRPC `router.ts` file exports the `appRouter` object, `AppRouter` type and all the views we have defined:

```tsx
import { router } from './init.ts';
import { postRouter } from './routers/post.ts';
import { userRouter } from './routers/user.ts';

export const appRouter = router({
  post: postRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;

export * from './views.ts';
```

_Note: We try to keep magic to a minimum and you can handwrite the [generated client](https://github.com/nkzw-tech/fate/blob/main/example/client/src/fate.ts) if you prefer._

```bash
pnpm fate generate @your-org/server/trpc/router.ts client/src/fate.ts
```

_Note: fate uses the specified server module name to extract the server types it needs and uses the same module name to import the views into the generated client. Make sure that the module is available both at the root where you are running the CLI and in the client package._

## Creating a _fate_ Client

Now that we have generated the client types, all that remains is creating the instance of the fate client, and using it in our React app using the `FateClient` context provider.

Create a `fate.ts` file:

```tsx
import { createFateClient } from './lib/fate.generated';

export const fate = createFateClient({
  links: [
    httpBatchLink({
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          credentials: 'include',
        }),
      url: `${env('SERVER_URL')}/trpc`,
    }),
  ],
});
```

Now wrap your app with the `FateClient` provider:

```tsx
import { FateClient } from 'react-fate';
import { fate } from './fate.ts';

export function App() {
  return <FateClient client={fate}>{/* Components go here */}</FateClient>;
}
```

_And you are all set. Happy building!_
