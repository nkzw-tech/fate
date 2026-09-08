# _fate_

**_fate_** is a modern data client for React inspired by [Relay](https://relay.dev/) and [GraphQL](https://graphql.org/). It combines view composition, normalized caching, data masking, Async React features, live updates, and type-safe data fetching.

Check out [fate.technology](https://fate.technology) for documentation, examples, and guides.

## Quick Start Template

Create a new fate app with Vite+:

```bash
vp create fate my-app --template cloudflare
```

## Technologies

This template is a client plus Cloudflare Worker server app. It uses the Cloudflare fate transport, D1 with Drizzle, Better Auth, and Cloudflare Durable Objects for SSE-backed live updates.

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

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/) with [Drizzle](https://orm.drizzle.team/)
- Cloudflare Durable Objects for fate live SSE fanout
- [Better Auth](https://better-auth.com/) for authentication

### Folder Structure

- `client/` - The React client application using _fate_.
- `server/` - The Cloudflare Worker fate server using D1 with Drizzle.
- `server/db/migrations/` - D1 migrations, including the seed data used by the demo UI.

## Initial Setup

You'll need Node.js 24+, [Vite+](https://viteplus.dev/guide/), and a Cloudflare account if you plan to deploy.

Install dependencies:

```bash
vp install
```

Review `server/.env`, which is copied from `server/.env.example` when the app is created. The default local value points the client at Wrangler's local Worker:

```bash
VITE_SERVER_URL=http://localhost:8787
```

Set up the local D1 database, seed data, translations, and fate client support:

```bash
vp run dev:setup
```

Start the app:

```bash
vp run dev
```

The client runs at `http://localhost:6001` and the Worker runs at `http://localhost:8787`. Cloudflare fate requests go to `/fate`; live updates use the SSE endpoint at `/fate-live`.

The seeded demo login is:

- `alex@example.com`
- `password-alex`

## Development

Common commands from the project root:

- `vp run dev` starts the client and Worker together.
- `vp run dev:client` starts only the client.
- `vp run dev:server` starts only the Worker.
- `vp run dev:setup` applies local D1 migrations, runs fbtee setup, and prepares fate client support.
- `vp run fate:generate` refreshes fate client support after changing server views, roots, or mutations.
- `vp check --fix` formats, lints, and type-checks the workspace.
- `vp test` runs the test suite.
- `vp run build` type-checks the Worker and builds the client.

## Deploying to Cloudflare

Create a D1 database and copy the generated `database_id` into `server/wrangler.jsonc`:

```bash
cd server
pnpm exec wrangler d1 create fate-cloudflare
```

Set a production Better Auth secret:

```bash
pnpm exec wrangler secret put BETTER_AUTH_SECRET
```

Apply the migrations to the remote D1 database:

```bash
pnpm run db:migrate:remote
```

Deploy the Worker:

```bash
pnpm run deploy
```

To test the local client against the deployed Worker, run this from the project root:

```bash
VITE_SERVER_URL="https://<your-worker>.<your-subdomain>.workers.dev" pnpm run dev:client
```

If you deploy the client to a hosted origin, add that origin to `server/src/lib/origins.ts`.

## Translations

The React app uses fbtee 4 with its native Oxc Vite plugin and CLI. Setup and builds generate the runtime translation files automatically.

- Wrap UI text in `<fbt desc="Translator context">Text</fbt>`; use `fbs('Text', 'Translator context')` from `fbtee` for string attributes such as placeholders.
- Run `vp run fbtee:collect` in `client/` to extract strings, then `vp run fbtee:prepare` to update the editable German and Japanese files in `translations/`.
- Translate entries marked `"status": "new"`, remove that status when finished, and run `vp run fbtee:translate` (or `vp run fbtee:all`). Commit `translations/`; runtime files in `src/translations/` are generated and ignored.
- Add locales to `src/lib/AvailableLanguages.tsx` and the `fbtee:prepare` script. The language selector remembers the choice. Server rendering starts in English and restores the browser preference after hydration.

Run `vp run start` in `client/` to serve the built frontend. Set `PORT` to change its default port of 3000, and run the backend separately.
