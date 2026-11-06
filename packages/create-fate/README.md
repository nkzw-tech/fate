# create-fate

Create a new fate app:

```sh
vp create fate
```

Dependencies are installed during creation. Templates that use a server also generate the fate client.

Choose between these templates:

- `client-only` uses Void Pages Routing with local state persisted in IndexedDB.
- `void`: Void pages router with Drizzle, live updates, and native Cloudflare deployment.
- `drizzle`: tRPC with Drizzle.
- `graphql`: GraphQL with Prisma.
- `graphql-client`: Client for an existing GraphQL server (e.g. React or Vue).
- `http`: Native HTTP with Drizzle.
- `prisma`: tRPC with Prisma.

The template sources live in `packages/create-fate/templates/fate`.
