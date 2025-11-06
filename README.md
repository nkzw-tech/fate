# Fate

Fate is a modern data client for tRPC and React, inspired by [Relay](https://relay.dev/) and [GraphQL](https://graphql.org/). It combines view composition, normalized caching, data masking, and Async React with the type-safety of tRPC. Fate is designed to make data fetching and state management in React applications composable, declarative, and predictable.

- **View Composition:** Components declare their data requirements using co-located "Views". Views are composed into a single request per screen, minimizing network requests and eliminating waterfalls.
- **Normalized Cache:** Fate maintains a normalized cache for all data in your application. This enables efficient data updates through actions or mutations and avoids stale or duplicated data.
- **Data Masking & Strict Selection:** Fate enforces strict data selection for each view, and masks (hides) data that components did not request. This prevents accidental coupling between components and reduces overfetching.
- **Async React:** Fate uses modern Async React features like Actions, Suspense and `use` to support concurrent rendering and enable a seamless user experience.
- **Lists & Pagination:** Fate provides built-in support for connection-style lists with cursor-based pagination, making it easy to implement infinite scrolling and "load-more" functionality.
- **Optimistic Updates:** Fate supports declarative optimistic updates for mutations, allowing the UI to update immediately while the server request is in-flight. If the request fails, the cache is rolled back to its previous state.

## Why Fate?

GraphQL and Relay introduced several novel ideas: fragments co‑located with components, a normalized cache keyed by global identifiers, and a compiler that hoists fragments into a single network request. These innovations made it possible to build large applications where data requirements are modular and self‑contained.

At Nakazawa Tech, we build all our apps with GraphQL and Relay. We advocate for them in [talks](https://www.youtube.com/watch?v=rxPTEko8J7c&t=36s) and provide templates ([server](https://github.com/nkzw-tech/server-template), [client](https://github.com/nkzw-tech/web-app-template/tree/with-relay)) to help developers get started quickly.

However, GraphQL comes with its own type system and query language. If you are already using tRPC or another type‑safe RPC framework, adopting GraphQL is a significant investment to implement on the backend, preventing you from adopting Relay on the frontend. Other React data frameworks lack the ergonomics of Relay. They don't support data composition, co-located data requirements, and don't integrate well with modern React features. Optimistic updates usually require manually managing keys and imperative data updates, which is error-prone and tedious.

Fate takes the great ideas from Relay and puts them on top of tRPC. You get the best of both worlds: type safety between the client and server, and GraphQL-like ergonomics for data fetching.

## Installation

```bash
pnpm add @nkzw/fate react-fate
```

## Contributing Guide

### Initial Setup

You'll need Node.js 24+ and pnpm 10+.

- Run `pnpm install && pnpm dev:setup`.
- Set up a Postgres database locally and add the connection string to `.env` as `DATABASE_URL` or run `docker-compose up -d` to start postgres in a docker container.
- Postgres setup:

```SQL
CREATE ROLE fate WITH LOGIN PASSWORD 'echo';
CREATE DATABASE fate;
ALTER DATABASE fate OWNER TO fate;
```

- `pnpm prisma migrate dev` to create the database and run the migrations.
- You might want to run `pnpm prisma migrate reset` to seed the database with initial data.
- Run `pnpm dev` to run the example.

### Running Tests

- When changing framework code, you need to run `pnpm build`.
- Run `pnpm test` to run all tests.
- Run `pnpm tsgo` to run TypeScript, and `pnpm vitest` to run JavaScript tests.
- If `@nkzw/fate` or `react-fate` modules cannot be resolved it means you forgot to run `pnpm build`.
