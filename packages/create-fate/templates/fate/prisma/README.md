<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="/public/fate-logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="/public/fate-logo.svg">
    <img alt="Logo" src="/public/fate-logo.svg" width="50%">
  </picture>
</p>

**_fate_** is a modern data client for React inspired by [Relay](https://relay.dev/) and [GraphQL](https://graphql.org/). It combines view composition, normalized caching, data masking, Async React features, and type-safe data fetching.

Check out [fate.technology](https://fate.technology) for documentation, examples, and guides.

# _fate_ Quick Start Template

Create a new fate app with Vite+:

```bash
vp create fate my-app --template prisma
```

## Getting Started with _fate_

Read the [Getting Started Guide](https://fate.technology/guide/core-concepts) to learn how to use _fate_ in your React applications.

## Technologies

This default template combines the Nakazawa Tech's [Web App Template](https://github.com/nkzw-tech/web-app-template) and [Server Template](https://github.com/nkzw-tech/server-template) into a monorepo, with unified tooling and _fate_ as the data client. It currently uses tRPC with Prisma.

_This template lives on the edge._ It's a turbocharged starting point on top of an already optimized stack. It uses TypeScript Go, Vite+, and ships with sensible defaults to unlock an incredibly fast development experience. It follows the principles laid out in [Building Scalable Applications](https://www.youtube.com/watch?v=rxPTEko8J7c&t=36s).

Next to [_fate_](https://fate.technology), it comes with the following technologies:

### Client Technologies

- [Vite 8](https://vitejs.dev/)
- [React](https://reactjs.org/) with [React Compiler](https://react.dev/learn/react-compiler) enabled
- [Tailwind](https://tailwindcss.com/)
- [fbtee](https://github.com/nkzw-tech/fbtee) for i18n
- [Better Auth](https://www.better-auth.com/) for authentication
- [Void Pages Router](https://void.cloud/docs)
- [TypeScript](https://www.typescriptlang.org)
- [pnpm](https://pnpm.io/)

### Server Technologies

- [Prisma](https://www.prisma.io/) as the ORM, with the new ESM multi-file generated client.
- [tRPC](https://trpc.io/) for type-safe APIs.
- [Hono](https://hono.dev/)
- [Better Auth](https://better-auth.com/) for Authentication.

### Folder Structure

- `client/` - The React client application using _fate_.
- `server/` - The fate server using tRPC with Prisma.

## Initial Setup

You'll need Node.js 24+ and [Vite+](https://viteplus.dev/guide/).

- Run `vp install`.
- Copy `server/.env.example` to `server/.env`.
- Set up a Postgres database locally or run `docker-compose up -d` to start Postgres in a Docker container.
- Postgres setup:

```SQL
CREATE ROLE fate WITH LOGIN PASSWORD 'echo';
CREATE DATABASE fate;
ALTER DATABASE fate OWNER TO fate;
```

Then, at the root of the project, run:

- `vp run prisma migrate dev` to create the database and run the migrations.
- You might want to run `vp run prisma migrate reset` and `vp run prisma db seed` to seed the database with initial data.
- Run `vp run dev:setup` to generate the Prisma client.
- Run `vp run fate:generate` to regenerate the fate client code.
- Run `vp test` to run all tests.
- Run `vp run dev` to run the client and server.
- Visit `http://localhost:5173` to see the app in action.
