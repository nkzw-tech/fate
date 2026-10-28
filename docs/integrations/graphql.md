# GraphQL Integration

If your backend already exposes GraphQL, you can use it with fate. Define views and call requests and mutations as usual; fate builds the GraphQL operations for you.

## Template

Create a client for an existing GraphQL server with:

```bash
vp create fate -- --template graphql-client
```

Create a full GraphQL + Prisma example app with:

```bash
vp create fate -- --template graphql
```

Both templates include `src/fate/graphql.ts`, where you map your schema's queries and mutations to fate.

## GraphQL Schema Shape

The GraphQL transport expects a schema with Relay-style object identity and pagination:

- Entity objects include `id` and `__typename`.
- Object fetches use `nodes(ids:)` by default, or configured per-type query fields.
- List fields return Relay connections with `edges`, `cursor`, `node`, and `pageInfo`.
- Root queries and mutations return the entity type selected by the fate view.

For example, a `Post` list can be exposed as a normal GraphQL connection:

```graphql
type Query {
  posts(first: Int, after: String): PostConnection!
  viewer: User
  nodes(ids: [ID!]!): [Node]!
}

type PostConnection {
  edges: [PostEdge!]!
  pageInfo: PageInfo!
}
```

If your schema uses different root field names, keep the fate names you want on the client and map them with `fateGraphQL.roots`.

## Mapping Your Schema

Create `src/fate/graphql.ts` with your server's schema and the queries and mutations you want to use:

```tsx
import { readFileSync } from 'node:fs';

export const fateGraphQL = {
  schema: readFileSync(new URL('./schema.graphql', import.meta.url), 'utf8'),
  roots: { posts: {}, viewer: {} },
  mutations: {
    'post.like': { entity: 'Post', field: 'postLike' },
  },
} as const;
```

The `schema` option accepts schema definition language (SDL) text or a `GraphQLSchema` object. Install `graphql` in the package that generates the client when using SDL.

fate derives entity types, query arguments, and mutation inputs and results from the schema. Use `field` when a fate root name differs from its GraphQL query field, for example `viewer: { field: 'currentUser' }`. The schema is used during generation and is excluded from the browser bundle.

You can also define a mapping manually with [data views](/integrations/server#data-views) and a `Root` export.

## Vite Plugin

Configure the fate Vite plugin with the GraphQL transport and point it at the mapping module:

::: code-group

```tsx [React]
import { fate } from 'react-fate/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    fate({
      module: './src/fate/graphql.ts',
      transport: 'graphql',
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
      module: './src/fate/graphql.ts',
      transport: 'graphql',
    }),
  ],
});
```

:::

The plugin generates a typed `createFateClient` helper from your schema and GraphQL mapping. It also watches the mapping module and the files it imports during development.

## Generated Types

With a schema configured, `.fate/client.generated.ts` includes schema types. Use its `GraphQLEntities` types when defining client views:

```tsx
import { view } from 'react-fate';
import type { GraphQLEntities } from '../../.fate/client.generated.ts';

type User = GraphQLEntities['User'];

const UserCardView = view<User>()({
  name: true,
  username: true,
});
```

These types describe the fields you can select; the view exposes only the fields it selects. Connections appear as node arrays for composing views. Use `GraphQLTypes` for the original schema shapes or `GraphQLResponses` for response types with fate's `{ items, pagination }` connections.

Custom scalars default to `unknown`. Set `fateGraphQL.scalars` to describe their TypeScript types, for example `{ DateTime: 'string' }`. Use `{ input: 'string', output: 'string' }` when specifying each side separately. These mappings change types; they do not convert returned values.

Use `import type` for generated types. After updating the schema, run `fate generate` to refresh them.

## Creating a Client

Create the client with your GraphQL endpoint and provide it through the `FateClient` provider:

::: code-group

```tsx [React]
import { FateClient } from 'react-fate';
import { createFateClient } from 'react-fate/client';

const fate = createFateClient({
  headers: () => ({
    authorization: `Bearer ${token}`,
  }),
  url: 'https://api.example.com/graphql',
});

export function App() {
  return <FateClient client={fate}>{/* Components go here */}</FateClient>;
}
```

```vue [Vue]
<script setup lang="ts">
import { FateClient } from 'vue-fate';
import { createFateClient } from 'vue-fate/client';
import AppRoutes from './AppRoutes.vue';

const fate = createFateClient({
  headers: () => ({
    authorization: `Bearer ${token}`,
  }),
  url: 'https://api.example.com/graphql',
});
</script>

<template>
  <FateClient :client="fate">
    <AppRoutes />
  </FateClient>
</template>
```

:::

Use `fetch` when you need to customize credentials or reuse an application fetch wrapper:

```tsx
const fate = createFateClient({
  fetch: (input, init) =>
    fetch(input, {
      ...init,
      credentials: 'include',
    }),
  url: `${env('SERVER_URL')}/graphql`,
});
```

Queries made together are batched into one GraphQL operation. Mutations run separately and are not retried unless you configure [Persistence](/guide/persistence).

[Deferred fields](/guide/deferred-views) load when a component reads them. This uses ordinary GraphQL queries; incremental `@defer` responses are not supported yet.

## Streaming Batched Reads

For a server that supports GraphQL `@defer` and the `v0.2` incremental delivery protocol, enable streaming when creating your client:

```tsx
const fate = createFateClient({
  streaming: true,
  url: 'https://api.example.com/graphql',
});
```

Reads still share one HTTP request. Each read is wrapped in its own labeled `@defer` fragment and resolves when that operation's complete result arrives. Separate requests under separate Suspense boundaries can render independently, while one request continues to wait for all the data it declares.

The transport negotiates `multipart/mixed;incrementalSpec=v0.2` and also accepts complete JSON responses. Mutations continue to use ordinary JSON responses. Streaming is disabled by default; enable it only after configuring your server and verifying that your proxy forwards response chunks promptly. Unsupported directives and incompatible multipart protocols produce errors rather than silently retrying requests.

With GraphQL Yoga, install `@graphql-yoga/plugin-defer-stream` and add `useDeferStream()` to the server's plugins. Keep client timeouts and error boundaries in place: completed reads remain available if another operation fails or the connection ends, while unfinished reads reject. Canceling one read keeps the connection alive for its siblings; the connection is released when no reads still need it.

This mode delivers complete operation results through the existing normalized cache. Field-level patches and item-by-item `@stream` updates are not supported. Existing fate `defer()` selections remain lazy identity-based follow-up reads, which can themselves share a streaming batch.

## Refetch Fields

For servers without `nodes(ids:)`, configure a query field for each refetchable entity type:

```tsx
export const fateGraphQL = {
  byId: {
    Game: { field: 'fetch__Game' },
    User: { field: 'fetch__User', idArg: 'id' },
  },
  nodes: false,
  // Keep your schema, roots, and mutations here.
} as const;
```

`idArg` defaults to `id`. Each query must return one entity of the configured type and accept its ID. Other required arguments need defaults. With `nodes: false`, every type fetched by ID needs a mapping.

Choose lookup fields with the authorization rules your app needs. These fields are also used to load deferred fields and additional pages of nested lists.

### Refetching Through Existing Queries

If your API fetches users by username instead of ID, configure fate to use that query when refreshing a user:

```tsx
export const fateGraphQL = {
  schema,
  nodes: false,
  roots: {
    user: {},
  },
  refetch: {
    User: {
      root: 'user',
      args: { username: { field: 'username' } },
    },
  },
} as const;
```

Here `user` maps to `Query.user(username:)`. fate selects `username` automatically and uses its confirmed value for later reads, deferred fields, and pagination. Components only see it if their view selects it.

The user must have been fetched before fate can look it up by username. If the username changes elsewhere, refresh a parent or viewer query to get the new value.

Use `{ field: 'username' }` to read a scalar field, `{ value: 'public' }` for a constant, or `{ object: { ... } }` for a nested input object:

```tsx
args: {
  input: {
    object: {
      tenant: { value: 'public' },
      username: { field: 'username' },
    },
  },
}
```

You can check these arguments with `RefetchArguments<User, GraphQLFieldArguments['Query']['user']>` from `@nkzw/fate`. The query must return a single entity of the configured type.

## Object IDs

The transport converts between fate entity IDs and GraphQL node IDs. By default, it sends IDs as `${type}-${id}` and strips that prefix from returned IDs. Override this if your schema uses Relay global IDs, raw database IDs, or another encoding:

```tsx
const fate = createFateClient({
  decodeNodeId: (type, id) => {
    const [nodeType, nodeId] = atob(String(id)).split(':');
    if (nodeType !== type) {
      throw new Error(`Expected a ${type} node id.`);
    }
    return nodeId;
  },
  encodeNodeId: (type, id) => btoa(`${type}:${id}`),
  url: '/graphql',
});
```

If your GraphQL API already accepts and returns the same IDs you use in the app, return `id` from both functions.

## Requests and Arguments

Client code keeps using `useRequest` with the same shape as the other transports:

```tsx
const { posts, viewer } = useRequest({
  posts: {
    args: { first: 10 },
    list: PostView,
  },
  viewer: { view: UserView },
});
```

Root arguments are sent to the root GraphQL field. Nested relation arguments are scoped by relation name:

```tsx
const { posts } = useRequest({
  posts: {
    args: {
      comments: { first: 3 },
      first: 10,
    },
    list: PostWithCommentsView,
  },
});
```

This produces a root `posts(first: 10)` field and a nested `comments(first: 3)` field in the generated GraphQL selection.

## Mutations

Map fate mutation names to GraphQL mutation fields:

```tsx
export const fateGraphQL = {
  schema,
  mutations: {
    'post.like': { entity: 'Post', field: 'postLike' },
  },
  roots: {
    posts: { field: 'posts' },
  },
} as const;
```

By default, the input is sent as an `input` argument:

```graphql
mutation {
  postLike(input: { id: "12" }) {
    id
    likes
  }
}
```

Use `inputArg` when your schema uses a different argument name, or `inputArg: false` when the input object should be spread into field arguments:

```tsx
export const fateGraphQL = {
  schema,
  mutations: {
    'post.like': { entity: 'Post', field: 'likePost', inputArg: 'payload' },
    'user.follow': { entity: 'User', field: 'followUser', inputArg: false },
  },
} as const;
```

Call mutations through `fate.mutations`, as described in the [Actions Guide](/guide/actions). Pass a view to select fields from the result:

```tsx
const { result } = await fate.mutations.post.like({
  input: { id: post.id },
  view: PostView,
});

if (result) {
  console.log(result.title);
}
```

Without a selection, entity results expose only identity fields. For React Actions, use [`.with()`](/guide/actions#selecting-a-view-with-actions) to select additional fields.

For mappings without a schema, use `graphqlMutation` from `@nkzw/fate` to declare mutation types manually.

## Live Views

GraphQL live views use [GraphQL SSE](https://github.com/enisdenjo/graphql-sse). Install `graphql-sse` in the client package and leave `live` enabled, or pass `live: false` when your schema does not support subscriptions.

```tsx
const fate = createFateClient({
  live: {
    url: 'https://api.example.com/graphql/stream',
  },
  url: 'https://api.example.com/graphql',
});
```

The default subscription fields are `fateLiveNode` for `useLiveView` and `fateLiveConnection` for `useLiveListView`. Rename them with `entityField` and `connectionField`:

```tsx
const fate = createFateClient({
  live: {
    connectionField: 'liveConnection',
    entityField: 'liveNode',
    url: '/graphql/stream',
  },
  url: '/graphql',
});
```

Your server must implement these subscription fields. See the [GraphQL subscription example](https://github.com/nkzw-tech/fate/blob/main/example/server-graphql/src/graphql/live.tsx) for their event shapes and resolvers. For servers without these subscriptions, set `live: false`.

## Existing Servers

Your GraphQL server continues to handle authorization, validation, pagination, and mutation side effects. You don't need fate's server or ORM adapters.

## Schema-Aware Arguments

With a schema configured, fate checks arguments and sends them as typed GraphQL variables, including enum values. Required arguments and server defaults follow the schema; omitting a value is different from passing `null`.

Use valid SDL, including definitions for any custom directives. You can also pass a `GraphQLSchema` object.

Generation also exports `GraphQLInputs`, `GraphQLFieldArguments`, and `GraphQLSelectionArguments` from `.fate/client.generated.ts`. Use these types to check arguments inside reusable views:

```tsx
import type { GraphQLFieldArguments } from '../.fate/client.generated.ts';

const stateArgs = {
  biome: 'Grassland',
} satisfies GraphQLFieldArguments['Map']['state'];

const MapView = view<Map>()({
  id: true,
  state: { args: stateArgs },
});
```

## Errors and Partial Results

Query failures throw `GraphQLRequestError`, available from `react-fate` and `vue-fate`. You can inspect its `errors`, `path`, `extensions`, and HTTP `status`. Partial data is available as `error.data`, but isn't written to the cache.

Actions and mutations follow the [action error policy](/guide/actions#action--mutation-error-handling). Expected failures such as validation errors return `{ error, result: undefined }`, and optimistic changes roll back:

```tsx
import { GraphQLRequestError } from 'react-fate';

const { error } = await fate.mutations.post.like({ input: { id: post.id } });

if (error instanceof GraphQLRequestError && error.extensions?.code === 'BAD_USER_INPUT') {
  // Show a validation message next to the form.
}
```

Use standard `extensions.code` values such as `BAD_USER_INPUT` and `CONFLICT`, or numeric `extensions.http.status` values, to identify expected errors. Authentication, authorization, server, and network failures throw.

The HTTP status may still be `200` when GraphQL reports an error. For retry behavior with saved mutations, see [Persistence](/guide/persistence#trpc-graphql-and-custom-transports).
