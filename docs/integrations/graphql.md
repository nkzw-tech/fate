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

Create a module that exports data views, `Root`, and an optional `fateGraphQL` config. The Vite plugin reads this module during development and build time, generates the client wiring, and leaves your runtime GraphQL server unchanged.

```tsx
import { graphqlMutation } from '@nkzw/fate';
import { dataView, list, type Entity } from '@nkzw/fate/server';

type GraphQLUser = {
  id: string;
  name?: string | null;
  username?: string | null;
};

type GraphQLPost = {
  author?: GraphQLUser | null;
  id: string;
  title: string;
};

export const userDataView = dataView<GraphQLUser>('User')({
  id: true,
  name: true,
  username: true,
});

export const postDataView = dataView<GraphQLPost>('Post')({
  author: userDataView,
  id: true,
  title: true,
});

export type User = Entity<typeof userDataView, 'User'>;
export type Post = Entity<
  typeof postDataView,
  'Post',
  {
    author: User | null;
  }
>;

export const Root = {
  posts: list(postDataView),
  viewer: userDataView,
};

export const fateGraphQL = {
  roots: {
    posts: { field: 'posts' },
    viewer: { field: 'viewer' },
  },
} as const;
```

The data views describe the fields client components are allowed to select. `Root` describes the root operations available to `useRequest`. `fateGraphQL.roots` maps those root names to actual GraphQL fields. If the GraphQL field has the same name as the fate root, the `field` entry can be omitted.

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

The plugin generates a typed `createFateClient` helper from your views, roots, and GraphQL mapping. It also watches the mapping module and the files it imports during development.

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

GraphQL operations issued in the same microtask are batched into a single GraphQL query or mutation document with aliased fields.

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

Map fate mutation names to GraphQL mutation fields with `graphqlMutation`:

```tsx
export const fateGraphQL = {
  mutations: {
    'post.like': graphqlMutation<Post, { id: string }, Post>('Post', {
      field: 'postLike',
    }),
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
  mutations: {
    'post.like': graphqlMutation<Post, { id: string }, Post>('Post', {
      field: 'likePost',
      inputArg: 'payload',
    }),
    'user.follow': graphqlMutation<User, { id: string }, User>('User', {
      field: 'followUser',
      inputArg: false,
    }),
  },
} as const;
```

Mutations use the same `mutation(...)` API described in the [Actions Guide](/guide/actions). React clients can also expose those mutations as Actions for `useActionState`.

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

Use data views to expose only the fields the client should be able to select, keep GraphQL schema authorization in your server, and treat `src/fate/graphql.ts` as the contract between your GraphQL API and fate's client.

## Schema-Aware Arguments

Provide your server's schema in the mapping module to generate GraphQL argument contracts and send arguments as typed variables. The `schema` option accepts SDL text or a `GraphQLSchema` object and is evaluated during client generation:

```tsx
import { readFileSync } from 'node:fs';

export const fateGraphQL = {
  schema: readFileSync(new URL('./schema.graphql', import.meta.url), 'utf8'),
  roots: {
    maps: { field: 'maps' },
  },
  mutations: {
    'map.update': graphqlMutation<Map, UpdateMapInput, Map>('Map', {
      field: 'updateMap',
      inputArg: false,
    }),
  },
};
```

Install `graphql` in the package performing generation when passing SDL. Run `fate generate` again after updating the schema. Generated browser code contains argument metadata, not the SDL or GraphQL parser. Existing clients without a schema retain literal argument serialization; use schema-aware generation for enums.

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

`assumeValidSDL` skips SDL validation, so use it only when the annotations are known and the schema is validated elsewhere. Fate still extracts argument metadata at generation time; the browser bundle does not include the schema object.

For example, given `maps(biome: Biome)`, an argument `{ biome: 'Grassland' }` is sent as a variable declared with type `Biome`, rather than an invalid quoted enum literal. Variables also work for nested field arguments, input objects, lists, node IDs, and mutations. Batched operations use distinct variable names and separate query and mutation payloads. Mutation selection arguments are kept out of mutation inputs. A GraphQL mutation argument named `args` belongs in `input` like any other wire argument; use the mutation's `view` or its separate `args` option for selected field arguments. When calling `transport.mutate` directly, pass selected field arguments as its optional fourth parameter.

The generated client enforces root arguments in `client.request` and the React/Vue `useRequest` adapters. Mutation inputs are derived from the schema using the configured `inputArg`, replacing the manually declared input type for generated clients. Non-null arguments are required unless the schema supplies a default. Omitting an optional/defaulted value preserves its server default; explicit `null` remains distinct.

Generation also exports `GraphQLInputs`, `GraphQLFieldArguments`, and `GraphQLSelectionArguments` from `.fate/client.generated.ts`. Use field contracts to check arguments inside reusable views:

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

At runtime the transport checks selected field names, argument names, enum values, required inputs, built-in scalar types, and nested input objects before issuing an HTTP request. Custom scalar values have TypeScript type `unknown` and remain subject to server validation. These contracts cover arguments; they do not add support for GraphQL result shapes that the transport otherwise does not support.

For a manually constructed transport, extract metadata on the build/server side with `createGraphQLArgumentSchema` from `@nkzw/fate/vite`, then pass the serialized result as the transport's `schema` option. Keep that build-time helper out of browser modules.

## Errors and Partial Results

A failed GraphQL operation rejects with `GraphQLRequestError`. It preserves all
GraphQL `errors`, the first error's `path` and `extensions`, and the HTTP `status`
when available. HTTP errors use the same error type; network failures retain the
original fetch error.

Partial response data is available as `error.data` for explicit application
handling. It is unnormalized diagnostic data, not a successful typed result, and
fate does not write it to the cache. Successful sibling operations in the same
batch still resolve normally, including legitimate `null` results. Mutation
functions retain their `{ result, error }` result contract.
