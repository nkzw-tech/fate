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

The client mapping imports the SDL exported from the Pothos schema during `dev:setup`. From the client directory, configure the Vite plugin with:

```ts
fate({
  module: './graphql.ts',
  transport: 'graphql',
});
```

Fate derives entity fields, connection roots, mutation inputs, and selected results from the schema.
The server data views in `src/graphql/views.ts` remain responsible for live-event resolution,
including authorization and computed fields. They do not define the GraphQL client types.
