# Cloudflare Integration

Deploy fate directly to your own Cloudflare account with [Void](/integrations/void). The Void template includes the app, D1 database, Drizzle migrations, Better Auth, and live updates through `void-fate` and `void/live`.

## New Project

```sh
vp create fate -- my-app --template void
cd my-app
vp run dev:setup
vp run dev
```

Add `--framework vue` to the create command to use Vue instead of React.

## Deploy

From the project root:

```sh
vp exec void deploy --platform cloudflare
```

Void signs you into Cloudflare when needed, lets you select your account, provisions resources, applies checked-in database migrations, and deploys the app. It saves resource IDs in the root `wrangler.jsonc`; commit that updated config for subsequent deployments. A Void platform account is not required.

The template includes the `VOID_LIVE` Durable Object binding and its class migration. Keep them in `wrangler.jsonc` so live subscriptions can receive updates across requests. RPC requests use `/fate`, and live updates use `/fate-live`.

After changing your database schema or auth configuration, run `vp run db:generate`, review and commit the generated migrations, then deploy. The migrations must include the Better Auth schema used in production.

See [Void's Cloudflare deployment guide](https://void.cloud/integrations/cloudflare) for custom domains, secrets, and CI configuration.

## Migrating from cf-fate

Fate 1.6 replaces the standalone Cloudflare adapter and template with the Void integration. Use `--template void` for new projects and `transport: 'void'` in the fate Vite plugin.

For an existing app, move the Worker routes into Void's `routes/` directory and follow the [Void integration](/integrations/void) for the complete setup:

- Define the live stream with `defineLiveStream` from `void/live`.
- Use `createVoidFateLive`, `defineVoidFateRoute`, and `defineVoidFateLiveRoute` from `void-fate/server`.
- Let the generated client use `void/live/client` for live connections.
- Remove the `cf-fate` dependency and the custom Worker entry point.

Deploy the Void app as a new Worker with its `VOID_LIVE` binding and class migration. The old `FATE_LIVE` Durable Object class and its active connections are not migrated. Preserve existing database IDs and migration history when reusing your database, and reconnect clients to the new app after deployment.
