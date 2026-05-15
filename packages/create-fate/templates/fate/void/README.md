# _fate_ Void Template

Create a new fate app with Vite+:

```bash
vp create fate my-app --template void
```

This template uses the Void pages router with Drizzle, `void-fate`, `react-fate`, Better Auth, Tailwind, and React Compiler.

## Folder Structure

- `pages/` - Void page routes.
- `routes/` - API routes, including fate RPC and live SSE routes.
- `src/` - Shared application, fate, UI, and auth code.
- `db/` - Drizzle schema, migrations, queries, and seed data.

## Initial Setup

You'll need Node.js 24+ and [Vite+](https://viteplus.dev/guide/).

Install dependencies:

```bash
vp install
```

Set up Void local files, seed the local database, and prepare fate client support:

```bash
vp run dev:setup
```

Start the app:

```bash
vp run dev
```

The app runs at `http://localhost:6001`. fate RPC requests go to `/fate`; live updates use the SSE route at `/fate-live`.

## Development

Common commands from the project root:

- `vp run dev` starts the Void app.
- `vp run dev:setup` prepares Void, seeds the local database, and prepares fate client support.
- `vp run prepare:void` regenerates Void local files.
- `vp run fate:generate` refreshes fate client support after changing `src/fate/server.ts` or views.
- `vp run db:generate` generates Drizzle migration files from `db/schema.ts`.
- `vp run db:migrate` applies database migrations.
- `vp run db:seed` seeds the local database.
- `vp check --fix` formats, lints, and type-checks the workspace.
- `vp test` runs the test suite.
- `vp run build` builds the app.
