# Fate

A modern data client for tRPC and React, inspired by Relay.

- **Fragments:** Colocate data requirements with your components.
- **Optimized:** Fragments are aggregated to minimize network requests.
- **Optimistic:** Automatic optimistic updates and rollbacks.
- **Modern:** Uses modern async React features.

## Setup

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
- Run `pnpm dev:client`, `pnpm dev:server` to start the server.
