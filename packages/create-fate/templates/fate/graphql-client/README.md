# _fate_

**_fate_** is a modern data client for React inspired by [Relay](https://relay.dev/) and [GraphQL](https://graphql.org/). It combines view composition, normalized caching, data masking, Async React features, and type-safe data fetching.

## Existing GraphQL Template

Use this template when you want to use _fate_ with an existing GraphQL server.

```bash
vp create fate my-app --template graphql-client
```

## Connect Your Server

Set the GraphQL endpoint in `.env`:

```bash
VITE_GRAPHQL_URL="https://api.example.com/graphql"
```

If your server supports GraphQL SSE, set the live endpoint too:

```bash
VITE_GRAPHQL_LIVE_URL="https://api.example.com/graphql/stream"
```

Then edit `src/fate/graphql.ts`. This file is the mapping layer between your GraphQL schema and _fate_:

- `dataView(...)` describes the fields React components are allowed to select.
- `Root` describes the root GraphQL fields _fate_ can request.
- `fateGraphQL.roots` maps _fate_ root names to GraphQL field names.
- `fateGraphQL.mutations` maps _fate_ mutation names to GraphQL mutation fields.

The sample assumes your GraphQL server exposes:

- `viewer`
- `posts(first:, after:)`
- `node(id:)` or `nodes(ids:)`
- Relay-style connections with `edges`, `cursor`, `node`, and `pageInfo`
- Entity objects with stable `id` and `__typename`

Replace the sample `User` and `Post` views with your own schema types.

## Development

Install dependencies:

```bash
vp install
```

Generate the _fate_ client:

```bash
vp run fate:generate
```

Start the app:

```bash
vp run dev
```

Common commands:

- `vp run dev` starts the client.
- `vp run fate:generate` refreshes _fate_ client support after changing `src/fate/graphql.ts`.
- `vp check --fix` formats, lints, and type-checks the project.
- `vp run test:all` verifies the project.
