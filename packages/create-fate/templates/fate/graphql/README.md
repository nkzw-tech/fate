# _fate_

**_fate_** is a modern data client for React inspired by [Relay](https://relay.dev/) and [GraphQL](https://graphql.org/). It combines view composition, normalized caching, data masking, Async React features, and type-safe data fetching.

Check out [fate.technology](https://fate.technology) for documentation, examples, and guides.

## Quick Start Template

Create a new fate app with Vite+:

```bash
vp create fate my-app --template graphql
```

## Getting Started with _fate_

Read the [Getting Started Guide](https://fate.technology/guide/core-concepts) to learn how to use _fate_ in your React applications.

## Technologies

This default template combines the Nakazawa Tech's [Web App Template](https://github.com/nkzw-tech/web-app-template) and [Server Template](https://github.com/nkzw-tech/server-template) into a monorepo, with unified tooling and _fate_ as the data client. It currently uses GraphQL with Pothos, Relay-style connections, and Prisma.

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
- [GraphQL Yoga](https://the-guild.dev/graphql/yoga-server) and [Pothos](https://pothos-graphql.dev/) for the GraphQL API.
- [graphql-sse](https://github.com/enisdenjo/graphql-sse) for live updates.
- [Hono](https://hono.dev/)
- [Better Auth](https://better-auth.com/) for Authentication.

### Folder Structure

- `client/` - The React client application using _fate_.
- `server/` - The fate server using GraphQL with Pothos and Prisma.

## Initial Setup

You'll need Node.js 24+ and [Vite+](https://viteplus.dev/guide/).

Install dependencies:

```bash
vp install
```

Review `server/.env`, which is copied from `server/.env.example` when the app is created. The default local values expect:

- Postgres at `postgresql://fate:echo@localhost:5432/fate`.
- The server at `http://localhost:9000`.
- The client at `http://localhost:5173`.

Start Postgres with Docker:

```bash
docker-compose up -d
```

Alternatively, create the database manually:

```SQL
CREATE ROLE fate WITH LOGIN PASSWORD 'echo';
CREATE DATABASE fate;
ALTER DATABASE fate OWNER TO fate;
```

For local development, push the Prisma schema and seed the database:

```bash
vp run prisma db push
vp run prisma db seed
```

If you prefer migration files, use Prisma's migration workflow instead:

```bash
vp run prisma migrate dev --name init
vp run prisma db seed
```

Then generate local files:

```bash
vp run dev:setup
```

Start the app:

```bash
vp run dev
```

The client runs at `http://localhost:5173` and the server runs at `http://localhost:9000`. GraphQL requests go to `/graphql` and live updates use `/graphql/stream`.

## Development

Common commands from the project root:

- `vp run dev` starts the client and server together.
- `vp run dev:client` starts only the client.
- `vp run dev:server` starts only the server.
- `vp run dev:setup` generates the Prisma client, Pothos schema import map, fbtee setup, and fate client support.
- `vp run fate:generate` refreshes fate client support after changing server views, roots, or routers.
- `vp run prisma` runs Prisma CLI commands in the server package.
- `vp check --fix` formats, lints, and type-checks the workspace.
- `vp test` runs the test suite.
- `vp run build` builds the client and server.
