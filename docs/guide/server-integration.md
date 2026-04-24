# Server Integration

Until now, we have focused on the client-side API of fate. You'll need a tRPC backend that follows some conventions so you can generate a typed client using fate's CLI. _fate_ currently provides database adapters for Prisma and Drizzle, but the framework itself is not coupled to a particular ORM. The adapters both plug into the same runtime and expose the same tRPC procedure shape to the client.

## Conventions & Object Identity

fate expects that data is served by a tRPC backend that follows these conventions:

- A `byId` query for each data type to fetch individual objects by their unique identifier (`id`).
- A `list` query for fetching lists of objects with support for pagination.

Objects are identified by their ID and type name (`__typename`, e.g. `Post`, `User`), and stored by `__typename:id` (e.g. "Post:123") in the client cache. fate keeps list orderings under stable keys derived from the backend procedure and args. Relations are stored as IDs and returned to components as ViewRef tokens.

fate's type definitions might seem verbose at first glance. However, with fate's minimal API surface, AI tools can easily generate this code for you. For example, fate has a minimal CLI that generates types for the client, but you can also let your LLM write it by hand if you prefer.

> [!NOTE]
> You can adopt _fate_ incrementally in an existing tRPC codebase without changing your existing schema by adding these queries alongside your existing procedures.

## Data Views

Since clients can send arbitrary selection objects to the server, we need to implement a way to translate these selection objects into database queries without exposing raw database queries and private data to the client. On the client, we define views to select fields on each type. We can do the same on the server using fate data views and the `dataView` function from `@nkzw/fate/server`.

Create a `views.ts` file next to your root tRPC router that exports the data views for each type. The same data view shape works with both Prisma model types and Drizzle row types:

::: code-group

```tsx [Prisma]
import { dataView, type Entity } from '@nkzw/fate/server';
import type { User as PrismaUser } from '../prisma/prisma-client/client.ts';

export const userDataView = dataView<PrismaUser>('User')({
  id: true,
  name: true,
  username: true,
});

export type User = Entity<typeof userDataView, 'User'>;
```

```tsx [Drizzle]
import { dataView, type Entity } from '@nkzw/fate/server';
import type { UserRow } from '../drizzle/schema.ts';

export const userDataView = dataView<UserRow>('User')({
  id: true,
  name: true,
  username: true,
});

export type User = Entity<typeof userDataView, 'User'>;
```

:::

Now that we apply `userDataView` to the `byId` query, the server limits the selection to the fields defined in the data view, keeping private fields hidden from the client, and providing type safety for client views:

```tsx
const UserData = view<User>()({
  // Type-error + ignored during runtime.
  password: true,
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
});
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

We can define extra root-level lists and queries by exporting a `Root` object from our `views.ts` file using the same view syntax as everywhere else:

```tsx
export const Root = {
  categories: list(categoryDataView),
  commentSearch: { procedure: 'search', view: list(commentDataView) },
  events: list(eventDataView),
  posts: list(postDataView, { orderBy: { createdAt: 'desc', id: 'desc' } }),
  viewer: userDataView,
};
```

Entries that wrap their view in `list(...)` are treated as list resolvers and use the `procedure` name when calling the corresponding router procedure, defaulting to `list`. If you omit `list(...)`, fate treats the entry as a standard query and uses the view type name to infer the router name. You can pass default list options such as `orderBy` to `list(...)`; Fate always appends the id field as a tie-breaker when it is missing.

For the above `Root` definitions, you can make the following requests using `useRequest`:

```tsx
const query = 'Apple';

const { posts, categories, viewer } = useRequest({
  // Explicit Root queries:
  categories: { list: categoryView },
  commentSearch: { args: { query }, list: commentView },
  events: { list: eventView },
  posts: { list: postView },
  viewer: { view: userView },

  // Queries by id, if those entities have a `byId` query defined:
  post: { id: '12', view: postView },
  comment: { ids: ['6', '7'], view: commentView },
});
```

## Fate Setup

The Prisma and Drizzle integrations connect your data views to your database, bind fate's standard tRPC procedures, and expose helpers for custom queries and mutations.

Pass the `Root` export from `views.ts` to Fate in your tRPC `init.ts` file. Fate walks that view graph to find the data views it needs. `id` defaults to `"id"`, and Fate uses it as the fallback ordering for cursor pagination. Relations are inferred from the data view and ORM schema: a nested data view is loaded as a singular relation, `list(view)` is loaded as a list relation, and Drizzle join tables are discovered from relation metadata.

### Prisma

Use `createPrismaFate` from `@nkzw/fate/server/prisma` next to your tRPC helpers. By default, Fate reads Prisma delegates from `ctx.prisma` using each data view's type name:

```tsx
import { initTRPC } from '@trpc/server';
import { createPrismaFate } from '@nkzw/fate/server/prisma';
import type { AppContext } from './context.ts';
import { Root } from './views.ts';

const t = initTRPC.context<AppContext>().create();

export const router = t.router;
export const procedure = t.procedure;

export const fate = createPrismaFate<AppContext, typeof procedure>({
  procedure,
  views: Root,
});
```

If your Prisma client is not stored at `ctx.prisma`, pass `prisma: (ctx) => ctx.db`.

The Prisma integration translates view requests into Prisma `select`, `where`, `cursor`, `skip`, and `take` options. It also hydrates computed `count(...)` dependencies using Prisma `groupBy` when needed.

For custom Prisma queries and mutations, use `fate.createPlan` with `toPrismaSelect`:

```tsx
import { toPrismaSelect } from '@nkzw/fate/server';

const plan = fate.createPlan({
  ...input,
  ctx,
  view: postDataView,
});

const post = await ctx.prisma.post.update({
  data: {
    likes: {
      increment: 1,
    },
  },
  select: toPrismaSelect(plan),
  where: { id: input.id },
});

return plan.resolve(post);
```

### Drizzle

Use `createDrizzleFate` from `@nkzw/fate/server/drizzle`. Fate matches data view type names to Drizzle tables from your schema. The `db` option can be a Drizzle database object or a function that receives your tRPC context and returns a request-scoped database object:

```tsx
import { initTRPC } from '@trpc/server';
import { createDrizzleFate } from '@nkzw/fate/server/drizzle';
import db from '../drizzle/db.ts';
import schema from '../drizzle/schema.ts';
import type { AppContext } from './context.ts';
import { Root } from './views.ts';

const t = initTRPC.context<AppContext>().create();

export const router = t.router;
export const procedure = t.procedure;

export const fate = createDrizzleFate<AppContext, typeof procedure>({
  db,
  procedure,
  schema,
  views: Root,
});
```

If your database lives on the request context, pass a function instead:

```tsx
import schema from '../drizzle/schema.ts';
import { Root } from './views.ts';

export const fate = createDrizzleFate<AppContext, typeof procedure>({
  db: (ctx) => ctx.db,
  procedure,
  schema,
  views: Root,
});
```

The Drizzle adapter builds SQL queries from your registered data views. It selects only requested columns, hydrates singular, list, and many-to-many relations, supports nested cursor pagination, and hydrates computed `count(...)` dependencies with SQL grouped counts.

For request-specific sorting, prefer a custom root query that validates and translates explicit sort args.

For many-to-many relations, define the join table relations in your Drizzle schema. Fate discovers a join table that points at both the source table and the target table:

```tsx
export const fate = createDrizzleFate<AppContext, typeof procedure>({
  db,
  procedure,
  schema,
  views: Root,
});
```

You can still provide explicit join metadata when the schema is ambiguous:

```tsx
{
  manyToMany: {
    tags: {
      foreignColumn: postToTag.tagId,
      localColumn: postToTag.postId,
      table: postToTag,
    },
  },
  relations: {
    tags: {
      foreignKey: 'id',
      localKey: 'id',
      through: {
        foreignKey: 'tagId',
        localKey: 'postId',
      },
    },
  },
  table: post,
  view: postDataView,
}
```

Drizzle writes should stay ordinary Drizzle code. After creating or updating a row, use `fate.resolveById` to return the selected shape that the client asked for:

```tsx
const postId = await createPostRecord({
  authorId: ctx.sessionUser.id,
  content: input.content,
  title: input.title,
});

const post = await fate.resolveById({
  ctx,
  id: postId,
  input,
  view: postDataView,
});

return post;
```

## tRPC Procedures

Use `fate.procedures` to build the standard `byId` and `list` procedures expected by the generated fate client:

```tsx
import { fate, router } from '../init.ts';
import { postDataView } from '../views.ts';

export const postRouter = router({
  ...fate.procedures(postDataView),
});
```

You can disable the generated `list` procedure if a view should only be fetched by id:

```tsx
export const commentRouter = router({
  ...fate.procedures({
    list: false,
    view: commentDataView,
  }),
});
```

## Custom Queries

You can add custom root queries next to generated procedures. Define the root in `Root`, implement a matching tRPC procedure, and call `fate.resolveConnection`:

```tsx
export const Root = {
  commentSearch: { procedure: 'search', view: list(commentDataView) },
};
```

```tsx
import { ilike } from 'drizzle-orm';
import { fate } from '../init.ts';

export const commentRouter = router({
  ...fate.procedures({
    list: false,
    view: commentDataView,
  }),
  search: fate.connection({
    input: z.object({
      query: z.string().min(1, 'Search query is required'),
    }),
    query: ({ ctx, cursor, direction, input, take }) =>
      fate.resolveConnection({
        ctx,
        cursor,
        direction,
        extra: {
          where: ilike(comment.content, `%${input.args.query}%`),
        },
        input,
        take,
        view: commentDataView,
      }),
  }),
});
```

For Prisma, pass Prisma query options such as `{ where: { ... } }` in `extra` instead of a Drizzle SQL expression.

## Data View Resolvers

fate data views support computed fields. Use `computed`, `field`, and `count` to describe the hidden data needed to resolve a public field:

```tsx
import { computed, count, field } from '@nkzw/fate/server';

export const userDataView = dataView<UserItem>('User')({
  email: computed<UserItem, string | null, AppContext>({
    authorize: ({ id }, context) => context?.sessionUser?.id === id,
    select: {
      email: field('email'),
    },
    resolve: (_item, deps) => (deps.email as string | null) ?? null,
  }),
  id: true,
});

export const postDataView = dataView<PostItem>('Post')({
  commentCount: computed<PostItem, number>({
    select: {
      count: count('comments'),
    },
    resolve: (_item, deps) => (deps.count as number) ?? 0,
  }),
  id: true,
});
```

The adapters fetch the hidden `field(...)` and `count(...)` dependencies for you. This keeps private fields like `email` available to the resolver without exposing them to the client selection.

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

Now that we have generated the client types, all that remains is creating an instance of the fate client, and using it in our React app using the `FateClient` context provider:

```tsx
import { httpBatchLink } from '@trpc/client';
import { FateClient } from 'react-fate';
import { createFateClient } from './fate.ts';

export function App() {
  const fate = useMemo(
    () =>
      createFateClient({
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
      }),
    [],
  );
  return <FateClient client={fate}>{/* Components go here */}</FateClient>;
}
```

_And you are all set. Happy building!_
