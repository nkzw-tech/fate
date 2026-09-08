# _fate_

**_fate_** is a modern data client for React inspired by [Relay](https://relay.dev/) and [GraphQL](https://graphql.org/). It combines view composition, normalized caching, data masking, Async React features, and type-safe data fetching.

Check out [fate.technology](https://fate.technology) for documentation, examples, and guides.

## Quick Start Template

Create a new fate app with Vite+:

```bash
vp create fate my-app --template drizzle
```

## Getting Started with _fate_

Read the [Getting Started Guide](https://fate.technology/guide/core-concepts) to learn how to use _fate_ in your React applications.

## Technologies

This template combines the Nakazawa Tech's [Web App Template](https://github.com/nkzw-tech/web-app-template) and [Server Template](https://github.com/nkzw-tech/server-template) into a monorepo, with unified tooling and _fate_ as the data client. It uses tRPC with Drizzle.

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

- [Drizzle](https://orm.drizzle.team/) as the ORM.
- [tRPC](https://trpc.io/) for type-safe APIs.
- [Hono](https://hono.dev/)
- [Better Auth](https://better-auth.com/) for Authentication.

### Folder Structure

- `client/` - The React client application using _fate_.
- `server/` - The fate server using tRPC with Drizzle.

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

Then set up the schema, seed data, translations, and fate client support:

```bash
vp run dev:setup
```

Start the app:

```bash
vp run dev
```

The client runs at `http://localhost:5173` and the server runs at `http://localhost:9000`. tRPC requests go to `/trpc`; fate live updates use the SSE endpoint under `/fate/live`.

## Development

Common commands from the project root:

- `vp run dev` starts the client and server together.
- `vp run dev:client` starts only the client.
- `vp run dev:server` starts only the server.
- `vp run dev:setup` pushes the Drizzle schema, seeds the database, runs fbtee setup, and prepares fate client support.
- `vp run fate:generate` refreshes fate client support after changing server views, roots, or routers.
- `vp run drizzle` opens Drizzle Kit commands for the server package.
- `vp check --fix` formats, lints, and type-checks the workspace.
- `vp test` runs the test suite.
- `vp run build` builds the client and server.

## Translations

The React app uses fbtee 4 with its native Oxc Vite plugin and CLI. Setup and builds generate the runtime translation files automatically.

- Wrap UI text in `<fbt desc="Translator context">Text</fbt>`; use `fbs('Text', 'Translator context')` from `fbtee` for string attributes such as placeholders.
- Run `vp run fbtee:collect` in `client/` to extract strings, then `vp run fbtee:prepare` to update the editable German and Japanese files in `translations/`.
- Translate entries marked `"status": "new"`, remove that status when finished, and run `vp run fbtee:translate` (or `vp run fbtee:all`). Commit `translations/`; runtime files in `src/translations/` are generated and ignored.
- Add locales to `src/lib/AvailableLanguages.tsx` and the `fbtee:prepare` script. The language selector remembers the choice. Server rendering starts in English and restores the browser preference after hydration.

Run `vp run start` in `client/` to serve the built frontend. Set `PORT` to change its default port of 3000, and run the backend separately.
