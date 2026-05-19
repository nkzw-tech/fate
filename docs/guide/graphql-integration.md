# GraphQL Integration

_fate_ can use an existing GraphQL API as its transport. This keeps the React APIs, view composition, normalized cache, masking, requests, list views, live views, and actions the same while replacing the native or tRPC backend with GraphQL operations.

Use the GraphQL transport when your backend already exposes GraphQL and you want fate's client model without adding fate's native server protocol.

## Template

Create a client for an existing GraphQL server with:

```bash
vp create fate my-app --template graphql-client
```

Create a full GraphQL + Prisma example app with:

```bash
vp create fate my-app --template graphql
```

The client-only template is the smallest reference for the integration. It contains a `src/fate/graphql.ts` file that maps your GraphQL schema to fate views and roots.

## GraphQL Schema Shape

The GraphQL transport expects a schema with Relay-style object identity and pagination:

- Entity objects include `id` and `__typename`.
- Object fetches go through a `nodes(ids:)` field.
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

The data views describe the fields React components are allowed to select. `Root` describes the root operations available to `useRequest`. `fateGraphQL.roots` maps those root names to actual GraphQL fields. If the GraphQL field has the same name as the fate root, the `field` entry can be omitted.

## Vite Plugin

Configure the fate Vite plugin with the GraphQL transport and point it at the mapping module:

```tsx
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

The plugin generates a typed `createFateClient` helper from your views, roots, and GraphQL mapping. It also watches the mapping module and the files it imports during development.

## Creating a Client

Create the client with your GraphQL endpoint and provide it through the `FateClient` provider:

```tsx
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

Actions use the same `mutation(...)` and `useActionState` APIs described in the [Actions Guide](/guide/actions).

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

Use data views to expose only the fields the client should be able to select, keep GraphQL schema authorization in your server, and treat `src/fate/graphql.ts` as the contract between your GraphQL API and fate's React client.
