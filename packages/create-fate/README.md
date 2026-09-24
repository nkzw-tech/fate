# create-fate

Create a new fate app:

```sh
vp create fate
```

The generated app is installed and the fate client is generated during creation.

Choose between these templates:

- `void`: Void pages router with Drizzle, live updates, and native Cloudflare deployment.
- `drizzle`: tRPC with Drizzle.
- `graphql`: GraphQL with Prisma.
- `graphql-client`: Client for an existing GraphQL server (e.g. React or Vue).
- `http`: Native HTTP with Drizzle.
- `prisma`: tRPC with Prisma.

The template sources live in `packages/create-fate/templates/fate`.
