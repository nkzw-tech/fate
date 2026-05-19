# create-fate

Create a new fate app:

```sh
vp create fate my-app
```

The generated app is installed and the fate client is generated during creation.

Choose between these templates:

- `void`: Void pages router with Drizzle.
- `drizzle`: tRPC with Drizzle.
- `graphql`: GraphQL with Prisma.
- `graphql-client`: React client for an existing GraphQL server.
- `http`: Native HTTP with Drizzle.
- `prisma`: tRPC with Prisma.

For a non-interactive install:

```sh
vp create fate my-app --template void
```

The template sources live in `packages/create-fate/templates/fate`.
