# GraphQL Integration

_fate_ can use an existing GraphQL API as its transport. This keeps the adapter APIs, view composition, normalized cache, masking, requests, list views, live views, and mutations the same while replacing the native or tRPC backend with GraphQL operations.

Use the GraphQL transport when your backend already exposes GraphQL and you want fate's client model without adding fate's native server protocol.

## Template

Create a client for an existing GraphQL server with:

```bash
vp create fate -- --template graphql-client
```

Create a full GraphQL + Prisma example app with:

```bash
vp create fate -- --template graphql
```

The client-only template is the smallest reference for the integration. It contains a `src/fate/graphql.ts` file that maps your GraphQL schema to fate views and roots.

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

You can also describe selectable fields with [data views](/integrations/server#data-views) and export `Root` from the mapping module. Existing mappings without a schema remain supported.

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

With a schema configured, fate generates `.fate/schema.generated.ts`. Use its `GraphQLEntities` types when defining client views:

```tsx
import { view } from 'react-fate';
import type { GraphQLEntities } from '../../.fate/schema.generated.ts';

type User = GraphQLEntities['User'];

const UserCardView = view<User>()({
  name: true,
  username: true,
});
```

These types describe fields available to select. A view only exposes the fields it selects. Connection fields in `GraphQLEntities` expose node arrays for view composition. The generated file also exports `GraphQLTypes` for schema output shapes and `GraphQLResponses` for transport results, where connections use `{ items, pagination }`.

Custom scalars default to `unknown`. Set `fateGraphQL.scalars` to describe their TypeScript types, for example `{ DateTime: 'string' }`. Use `{ input: 'string', output: 'string' }` when specifying each side separately. These mappings change types; they do not convert returned values.

After updating the schema, run `fate generate` again to refresh the client types. Use `import type` for generated types so the mapping module can load before those files exist.

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

GraphQL queries issued in the same microtask are batched into a single document. Mutations queued together run in order as separate requests, so one failure does not prevent the next mutation from running. The transport does not automatically retry mutations.

Deferred view fields work with the GraphQL transport through the same normalized cache flow as native HTTP: the eager query omits `defer(...)` fields, and `useView`, `useListView`, or `useLiveListView` fetches the missing selection through `nodes(ids:)` when the deferred handle is read. GraphQL `@defer` is the natural wire format for this feature, but fate's GraphQL transport currently expects one JSON result per operation and does not consume incremental multipart patches yet.

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

`idArg` defaults to `id`. Each mapped field must return one entity of the named type, optionally nullable. The adapter batches multiple IDs into aliased query fields in one request, preserves input order for returned records, and omits null results. Node ID encoding and decoding apply to mapped fetches too.

Mappings take precedence over the default `nodes(ids:)` fallback. Set `nodes: false` to disable that fallback; fetching an unmapped type then reports a configuration error without issuing a request. Existing clients need no configuration changes. Direct users of `createGraphQLTransport` can pass the same `byId` and `nodes` options.

When `schema` is supplied, codegen and transport construction validate the mapping: the field must exist, its ID argument must accept a single `ID`, `String`, or `Int`, its result must match the concrete entity type, and any other arguments must be optional or have defaults. Schema metadata also supplies the wire variable types. Without a schema, identifiers are validated and arguments use GraphQL literals.

Nested pagination uses the owner ID only for the mapped query field. Pagination and filter arguments remain on the connection field. For example, fetching another page of a user's games produces `fetch__User(id: $owner) { games(first: $count, after: $cursor) { ... } }`.

Choose fields with the appropriate authorization rules for the consuming views. The adapter does not switch between public and authenticated lookup fields automatically.

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

Here `user` maps to `Query.user(username:)`. fate automatically selects and caches `username` whenever it fetches a user. Components only see the username if their view selects it. Later entity reads, deferred fields, and nested pagination use this query instead of `byId` or `nodes`.

Refetch arguments use confirmed cached values, so optimistic username changes do not affect the lookup. The result must match the user's original ID. A missing user raises `FateRequestError('NOT_FOUND')` without deleting cached data. If the username changes elsewhere, refresh a parent or viewer query to get the new value. Requesting an ID before fate has cached its username fails because fate cannot construct the lookup.

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

Without a selection, entity results expose only identity fields. React clients can also use `fate.actions` with `useActionState`; those action results expose identity fields, while selected fields update the cache for views to read.

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

The live node subscription returns `{ data, delete, id, select }`. The live connection subscription returns events such as `appendNode`, `prependNode`, `deleteEdge`, and `invalidate`. These payloads match fate's live transport events, so the cache update behavior is the same as the native transport.

If you do not need live views, disable them explicitly:

```tsx
const fate = createFateClient({
  live: false,
  url: '/graphql',
});
```

## Existing Servers

The GraphQL transport is intentionally a mapping layer. It does not require `createFateServer`, the Prisma adapter, or the Drizzle adapter. Your GraphQL server remains responsible for authorization, validation, resolver behavior, cursor pagination, and mutation side effects.

Keep authorization in your GraphQL server. Server data views can still resolve live updates and computed fields; client types come from the schema configured in `src/fate/graphql.ts`.

## Schema-Aware Arguments

With a schema configured, fate sends arguments as typed GraphQL variables. For example, given `posts(category: PostCategory)`, `{ category: 'News' }` is sent as a variable of type `PostCategory`. Clients without a schema use literal arguments, which cannot represent enums correctly.

Generated clients check query and mutation arguments against the schema. Non-null arguments are required unless they have a default. Omitting a value preserves its server default; passing `null` is distinct.

SDL text must include definitions for every directive it uses. Some server-generated or Relay-oriented schema files contain annotations such as `@auth` or `@fetchable` without declaring them; strict SDL parsing rejects those files. Prefer adding the directive definitions to the exported SDL. If the omissions are intentional, pass a schema object instead:

```tsx
import { readFileSync } from 'node:fs';
import { buildSchema } from 'graphql';

const sdl = readFileSync(new URL('./schema.graphql', import.meta.url), 'utf8');
export const fateGraphQL = {
  schema: buildSchema(sdl, { assumeValidSDL: true }),
  // ...roots and mutations...
};
```

`assumeValidSDL` skips SDL validation, so use it only when the annotations are known and the schema is validated elsewhere.

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

The transport also validates arguments before sending a request. Custom scalars still require server validation.

For custom build tooling, use `createGraphQLSchemaSource` to generate schema types or `createGraphQLArgumentSchema` to extract transport metadata. Both helpers come from `@nkzw/fate/vite` and run outside the browser.

## Errors and Partial Results

GraphQL query errors reject with `GraphQLRequestError`. It includes the GraphQL `errors`, the first error's `path` and `extensions`, and the HTTP `status`. Partial response data is available as `error.data` for diagnostics and is never written to the cache. Successful operations in the same batch still resolve normally.

Actions and mutations follow the [action error policy](/guide/actions#action--mutation-error-handling). Expected failures such as validation errors return `{ error, result: undefined }`, and optimistic changes roll back:

```tsx
import { GraphQLRequestError } from 'react-fate';

const { error } = await fate.mutations.post.like({ input: { id: post.id } });

if (error instanceof GraphQLRequestError && error.extensions?.code === 'BAD_USER_INPUT') {
  // Show a validation message next to the form.
}
```

fate recognizes standard `extensions.code` values such as `BAD_USER_INPUT`, `CONFLICT`, and `INTERNAL_SERVER_ERROR`, as well as numeric `extensions.http.status` values. Authentication, authorization, and server failures throw. Without durable delivery, execution errors without a recognized status are returned to the caller. Network failures throw the original fetch error. Malformed responses throw a `GraphQLRequestError` with `error.kind === 'protocol'`.

The error's `status` is the original HTTP status, which may be `200` even when GraphQL reports an execution error. For retry behavior with saved mutations, see [Persistence](/guide/persistence#trpc-graphql-and-custom-transports).
