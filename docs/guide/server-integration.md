# Server Integration

Until now, we have focused on the client-side API of fate. You'll need a backend that follows fate's data protocol so the Vite plugin can provide a typed client module. _fate_ currently ships two server paths:

- The native Fate protocol, which is transport-agnostic and can be hosted by any Fetch-compatible server.
- The tRPC adapter, which keeps compatibility with existing tRPC backends.

_fate_ currently provides database adapters for Prisma and Drizzle, but the framework itself is not coupled to a particular ORM. The adapters plug into the same source execution runtime and can be exposed through the native protocol or through tRPC.

## Conventions & Object Identity

fate expects that data is served by a backend that follows these conventions:

- A `byId` query for each data type to fetch individual objects by their unique identifier (`id`).
- A `list` query for fetching lists of objects with support for pagination.

Objects are identified by their ID and type name (`__typename`, e.g. `Post`, `User`), and stored by `__typename:id` (e.g. "Post:123") in the client cache. fate keeps list orderings under stable keys derived from the backend procedure and args. Relations are stored as IDs and returned to components as ViewRef tokens.

fate's type definitions might seem verbose at first glance. However, with fate's minimal API surface, AI tools can easily generate this code for you, or you can let the Vite plugin provide the typed client module for your app.

> [!NOTE]
> You can adopt _fate_ incrementally in an existing tRPC codebase without changing your existing schema by adding these queries alongside your existing procedures.

## Data Views

Since clients can send arbitrary selection objects to the server, we need to implement a way to translate these selection objects into database queries without exposing raw database queries and private data to the client. On the client, we define views to select fields on each type. We can do the same on the server using fate data views and the `dataView` function from `@nkzw/fate/server`.

Create a `views.ts` file next to your server entry that exports the data views for each type. The same data view shape works with both Prisma model types and Drizzle row types:

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
  comments: list(commentDataView, { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
});
```

We can define extra root-level lists and queries by exporting a `Root` object from our `views.ts` file using the same view syntax as everywhere else:

```tsx
export const Root = {
  categories: list(categoryDataView, { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
  commentSearch: {
    procedure: 'search',
    view: list(commentDataView, { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
  },
  events: list(eventDataView, { orderBy: [{ startAt: 'asc' }, { id: 'asc' }] }),
  posts: list(postDataView, { orderBy: { createdAt: 'desc', id: 'desc' } }),
  viewer: userDataView,
};
```

Entries that wrap their view in `list(...)` are treated as list resolvers. In the native protocol, the root key is the operation name sent by the generated client. In the tRPC adapter, `procedure` can point that root at a specific router procedure. If you omit `list(...)`, fate treats the entry as a standard query.

You can pass default list options such as `orderBy` to `list(...)`. Ordering is scoped to that specific list wrapper: `Root.posts` can order posts by `createdAt desc`, while `categoryDataView.posts` or `postDataView.comments` can choose their own order. If no order is provided, Fate orders by `id asc`. Fate always appends `id asc` as a tie-breaker when no `id` order is present; include `id` yourself when you need a different tie-breaker direction such as `id desc`. Use the array form when ordering by multiple fields so the priority is unambiguous.

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

## Native Fate Protocol

The native protocol keeps tRPC optional. Create a source adapter from your ORM integration, pass it to `createFateServer`, and expose the returned server through a Fetch-compatible handler.

```tsx
import { createFateServer, createHonoFateHandler } from '@nkzw/fate/server';
import { createPrismaSourceAdapter } from '@nkzw/fate/server/prisma';
import { Hono } from 'hono';
import type { AppContext } from './context.ts';
import { prisma } from './prisma.ts';
import { Root, userDataView } from './views.ts';

export { Root } from './views.ts';

const sources = createPrismaSourceAdapter<AppContext>({
  prisma: (ctx) => ctx.prisma,
  views: Root,
});

export const fate = createFateServer({
  context: async ({ adapterContext }) => ({
    prisma,
    request: adapterContext.req.raw,
    sessionUser: await getSessionUser(adapterContext.req.raw),
  }),
  queries: {
    viewer: {
      resolve: ({ ctx, select }) =>
        sources.resolveById({
          ctx,
          id: ctx.sessionUser.id,
          input: { select },
          view: userDataView,
        }),
    },
  },
  roots: Root,
  sources,
});

const app = new Hono();
const handler = createHonoFateHandler(fate);

app.post('/fate', handler);
app.post('/fate/live', handler);
```

Configure the Vite plugin with the native transport:

```tsx
import { fate } from '@nkzw/fate/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    fate({
      module: '@your-org/server/fate.ts',
      transport: 'native',
    }),
  ],
});
```

The generated client uses `createHTTPTransport`:

```tsx
import { createFateClient } from '@nkzw/fate/client';

const client = createFateClient({
  url: '/fate',
});
```

The HTTP transport batches operations issued in the same microtask into one `POST /fate` request. Live views use `POST /fate/live` with `text/event-stream` so the client can send the selected fields and args in the request body.

### Custom Queries

Root query entries such as `viewer` need an explicit resolver because fate cannot infer application-specific behavior like "current user" from a data view:

```tsx
export const fate = createFateServer({
  context,
  queries: {
    viewer: {
      resolve: ({ ctx, select }) =>
        sources.resolveById({
          ctx,
          id: ctx.sessionUser.id,
          input: { select },
          view: userDataView,
        }),
    },
  },
  roots: Root,
  sources,
});
```

### Custom Mutations

Mutations declare the entity type they return and receive the selected fields requested by the client. Resolve the updated record through the source adapter so the response has the same masking and relation behavior as regular view requests:

```tsx
export const fate = createFateServer({
  mutations: {
    'post.like': {
      input: likeInput,
      resolve: async ({ ctx, input, select }) => {
        await ctx.prisma.post.update({
          data: { likes: { increment: 1 } },
          where: { id: input.id },
        });

        return sources.resolveById({
          ctx,
          id: input.id,
          input: { select },
          view: postDataView,
        });
      },
      type: 'Post',
    },
  },
  roots: Root,
  sources,
});
```

### Live Views

Pass a live event bus to enable `useLiveView` over the native SSE endpoint:

```tsx
import { createLiveEventBus } from '@nkzw/fate/server';

export const live = createLiveEventBus();

export const fate = createFateServer({
  live,
  queries: {
    viewer: {
      resolve: ({ ctx, select }) =>
        sources.resolveById({
          ctx,
          id: ctx.sessionUser.id,
          input: { select },
          view: userDataView,
        }),
    },
  },
  roots: Root,
  sources,
});

live.update('Post', post.id, { eventId: `post:${post.id}:${Date.now()}` });
```

## tRPC Fate Setup

The Prisma and Drizzle tRPC integrations connect your data views to your database, bind fate's standard tRPC procedures, and expose helpers for custom queries and mutations.

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

The Drizzle adapter builds SQL queries from your registered data views. It selects only requested columns, hydrates singular, list, and many-to-many relations, supports nested cursor pagination, and hydrates computed `count(...)` dependencies with SQL grouped counts. Count filters may be plain equality objects or Drizzle SQL predicates written as `(columns) => eq(columns.status, 'GOING')`.

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

## Configuring the typed client

Now that we have defined our client views and our tRPC server, we need to connect them with some glue code. We recommend using fate's Vite plugin for convenience.

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

Configure the fate Vite plugin with your server module:

```tsx
import { fate } from '@nkzw/fate/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    fate({
      module: '@your-org/server/trpc/router.ts',
    }),
  ],
});
```

_Note: fate uses the specified server module name to extract the server types it needs and uses the same module name in the generated client. Make sure that the module is available to the client package's Vite config._

During development, the plugin watches the server module and the files it imports. When one of those files changes, fate regenerates the project-local client and invalidates `@nkzw/fate/client` in Vite's module graph.

The plugin writes project-local types under `.fate/`. If your TypeScript config does not already include dot-directories, extend the generated config:

```json
{
  "extends": "./.fate/tsconfig.json"
}
```

## Creating a _fate_ Client

Now that the Vite plugin provides the client types, all that remains is creating an instance of the fate client, and using it in our React app using the `FateClient` context provider:

```tsx
import { httpBatchLink } from '@trpc/client';
import { FateClient } from 'react-fate';
import { createFateClient } from '@nkzw/fate/client';

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
