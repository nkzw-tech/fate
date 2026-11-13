# Server Integration

Now that we have defined our client views, let's connect them to a backend. fate supports three approaches:

- Native HTTP with any Fetch-compatible server.
- tRPC for an existing tRPC backend.
- [GraphQL](/integrations/graphql) for an existing GraphQL API.

The Prisma and Drizzle adapters turn your server data views into database queries. Both work with native HTTP and tRPC.

## Conventions & Object Identity

fate expects that data is served by a backend that follows these conventions:

- A `byId` query for each data type to fetch individual objects by their unique identifier (`id`).
- A `list` query for fetching lists of objects with support for pagination.

Each object needs an ID and a type name (`__typename`, such as `Post` or `User`). fate uses them to share the object between views in the client cache.

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

Use `list(...)` for a list resolver and a plain data view for a standard query. In the native protocol, the root key is the operation name used by the client. In the tRPC adapter, `procedure` can point that root at a specific router procedure.

Each `list(...)` can have its own ordering. For example, the feed can show newest posts first while comments use oldest first. Without `orderBy`, fate sorts by `id asc`. It also adds `id asc` as a tie-breaker when your ordering doesn't include `id`. Use an array when ordering by several fields.

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

### Lists with Several Types

Let's add a `search` list that returns both posts and users. Pass a data view for each type to `list`, along with a query that finds the results for each page. The data view keys match the type names, and each view selects `id`. The `typeName` gives the combined type its own name in the generated client.

Mixed-list membership grants access through the list query. Register an authorized standalone read for members that need direct by-ID lookups, including deferred reads.

```tsx
import { list } from '@nkzw/fate/server';

export const Root = {
  search: list(
    { Post: postDataView, User: userDataView },
    {
      query: querySearch,
      typeName: 'SearchResult',
    },
  ),
};
```

Your `querySearch` function receives `args`, `ctx`, `cursor`, `direction`, and `take`. Return up to `take` entries in display order, starting after the cursor for forward pagination or ending before it for backward pagination. Each entry has a `__typename`, a string `id`, and a unique nonempty string `cursor`. Include each `(__typename, id)` pair once across the results. `take` includes one extra entry so fate can tell whether there's another page. fate fetches the selected fields in batches for each type and applies the permissions from its data view.

For native HTTP, pass `Root` to `createFateServer`. For tRPC, use `fate.procedures` and register the router as `searchResult` in `appRouter`.

```tsx
const searchResultRouter = router(fate.procedures({ view: Root.search }));
```

To use a different router name, set `router` on the entry in `Root`, for example `search: { router: 'search', view: searchList }`. On the client, use [`viewFor` to compose the views](/integrations/graphql#views-on-unions-and-interfaces) for the search results.

Live membership events refresh mixed lists through the same scoped query. This applies the subscriber’s access rules and reloads the fields selected by each view.

## Native fate protocol

Create a source adapter for your ORM, pass it to `createFateServer`, and add a route for the HTTP handler:

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
app.all('/fate/live', handler);
```

Configure the Vite plugin with the native transport:

::: code-group

```tsx [React]
import { fate } from 'react-fate/vite';
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

```ts [Vue]
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { fate } from 'vue-fate/vite';

export default defineConfig({
  plugins: [
    vue(),
    fate({
      module: '@your-org/server/fate.ts',
      transport: 'native',
    }),
  ],
});
```

:::

With the native transport, the Vite plugin handles the HTTP transport setup. If you need to create a client manually, use `createFateClient` with the same route:

::: code-group

```tsx [React]
import { createFateClient } from 'react-fate/client';

const client = createFateClient({
  url: '/fate',
});
```

```ts [Vue]
import { createFateClient } from 'vue-fate/client';

const client = createFateClient({
  url: '/fate',
});
```

:::

Calls made together are batched into one HTTP request. The `/fate/live` route is used for [Live Views](/guide/live-views).

### Custom Queries

The `viewer` query above needs a resolver because only your app knows which user is signed in. Use `sources.resolveById` to return that user's selected fields.

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

Follow the [Live Views server setup](/guide/live-views#server-setup) to add an event bus. After a mutation changes a post, emit an update:

```tsx
live.update('Post', post.id, { changed: ['likes'] });
```

The optional `changed` list limits the update to those fields.

## tRPC fate setup

The Prisma and Drizzle tRPC integrations connect your data views to your database, bind fate's standard tRPC procedures, and expose helpers for custom queries and mutations.

Pass the `Root` export from `views.ts` to the ORM helper in your tRPC `init.ts` file:

### Prisma

Use `createPrismaFate` from `@nkzw/fate/server/prisma` next to your tRPC helpers. By default, fate reads Prisma delegates from `ctx.prisma` using each data view's type name:

```tsx
import { createPrismaFate } from '@nkzw/fate/server/prisma';
import { initTRPC } from '@trpc/server';
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

Use `createDrizzleFate` from `@nkzw/fate/server/drizzle`. fate matches data view type names to Drizzle tables from your schema. The `db` option can be a Drizzle database object or a function that receives your tRPC context and returns a request-scoped database object:

```tsx
import { createDrizzleFate } from '@nkzw/fate/server/drizzle';
import { initTRPC } from '@trpc/server';
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

The Drizzle adapter loads the selected fields and relations for you. By default,
nested pagination queries each parent separately. On databases that support
window functions, set `nestedPaginationBatching: true` to group parents into
window queries, including cursor-based and many-to-many pages. Each query
returns at most the requested page size plus one row per parent. Large parent
sets are split into bounded batches.

Independent sibling relations load concurrently. Nested hydration shares a limit
of 10 active database queries across sibling and recursive relations in each
source fetch; set `nestedPaginationConcurrency` to match your database pool. Query slots are released
before recursively hydrating children.

Both paths preserve the same ordering, cursors, and page metadata.

Count filters can use equality objects or Drizzle predicates such as `(columns) => eq(columns.status, 'GOING')`.

For request-specific sorting, prefer a custom root query that validates and translates explicit sort args.

Define many-to-many joins in your Drizzle schema so fate can discover them. If a join is ambiguous, provide its metadata explicitly:

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

Use `fate.procedures` to build the standard `byId` and `list` procedures expected by fate's request APIs:

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

Data views can define computed fields with their own data dependencies. Let's say we want to show a user's email only to that user, and include a comment count on each post. We can define both fields with `memo`:

```tsx
import { memo, count } from '@nkzw/fate/server';

export const userDataView = dataView<UserItem>('User')({
  email: memo({
    authorize: ({ id }, context?: AppContext) => context?.sessionUser?.id === id,
    select: {
      email: true,
    },
    resolve: (_item: UserItem, { email }) => email ?? null,
  }),
  id: true,
});

export const postDataView = dataView<PostItem>('Post')({
  commentCount: memo({
    select: {
      count: count('comments'),
    },
    resolve: (_item: PostItem, { count }) => count,
  }),
  id: true,
});
```

The `select` object describes what each resolver needs. `email: true` selects the user's stored email, and `count('comments')` asks the adapter to count the post's comments. The resolver receives those values in its second argument. Annotating the first argument with `UserItem` or `PostItem` lets TypeScript infer the dependency types.

Use `field('path')` to give a dependency a different name or read through a relationship. The adapters fetch the dependencies for you, while the client only receives the computed field's result. The same `dataView` and `memo` helpers are available for [client computed fields](/guide/client-state#computed-fields).

## Connecting the Client

Now that we have defined our client views and our server module, add fate's Vite plugin to the client app. The plugin reads your server exports and wires the typed fate APIs into your app.

For tRPC, make sure the `router.ts` file exports the `appRouter` object, `AppRouter` type and all the views we have defined:

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

::: code-group

```tsx [React]
import { fate } from 'react-fate/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    fate({
      module: '@your-org/server/trpc/router.ts',
    }),
  ],
});
```

```ts [Vue]
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { fate } from 'vue-fate/vite';

export default defineConfig({
  plugins: [
    vue(),
    fate({
      module: '@your-org/server/trpc/router.ts',
    }),
  ],
});
```

:::

_Note: fate uses the specified server module name to find the server types it needs. Make sure that the module is available to the client package's Vite config._

The plugin updates the client when your server files change. For an app without React or Vue, use `@nkzw/fate/vite` and `@nkzw/fate/client` instead.

The plugin writes project-local types under `.fate/`. If your TypeScript config does not already include dot-directories, extend the generated config:

```json
{
  "extends": "./.fate/tsconfig.json"
}
```

## Creating a _fate_ Client

Now that the Vite plugin has connected the types, create a fate client instance and provide it to your app with the `FateClient` provider:

::: code-group

```tsx [React]
import { httpBatchLink } from '@trpc/client';
import { FateClient } from 'react-fate';
import { createFateClient } from 'react-fate/client';

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

```vue [Vue]
<script setup lang="ts">
import { httpBatchLink } from '@trpc/client';
import { computed } from 'vue';
import { FateClient } from 'vue-fate';
import { createFateClient } from 'vue-fate/client';
import AppRoutes from './AppRoutes.vue';

const fate = computed(() =>
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
);
</script>

<template>
  <FateClient :client="fate">
    <AppRoutes />
  </FateClient>
</template>
```

:::

_And you are all set. Happy building!_
