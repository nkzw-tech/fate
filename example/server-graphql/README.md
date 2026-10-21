# Fate GraphQL Example

This server mirrors `example/server-prisma` with a Pothos GraphQL API instead of tRPC.
It exposes Relay `node`/`nodes`, Relay connections for Fate list fields, GraphQL mutations
for the existing Fate mutations, and GraphQL SSE subscriptions for Fate live updates.

Run it from this directory:

```sh
vp run dev:setup
vp run prisma migrate dev
vp run dev
```

The server defaults to `http://localhost:9021/graphql`.

`vp run dev:setup` exports the GraphQL schema for the client. From the client directory, point the Vite plugin at the mapping module:

```ts
fate({
  module: './graphql.ts',
  transport: 'graphql',
});
```

fate generates client types from the schema. Server data views in `src/graphql/views.ts` handle live updates, authorization, and computed fields.
