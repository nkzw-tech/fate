# create-fate

Create a new fate app:

```sh
vp create fate my-app
```

Choose between these templates:

- `void`: Void pages router with Drizzle.
- `drizzle`: tRPC with Drizzle.
- `http`: Native HTTP with Drizzle.
- `prisma`: tRPC with Prisma.

For a non-interactive install:

```sh
vp create fate my-app --template void
```

The template sources live in `packages/create-fate/templates/fate`.
