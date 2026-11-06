# Client-only fate

A task list with Void Pages Routing, `react-fate`, and IndexedDB. Try adding, completing, or removing a task, then reload to see the saved state. The About page demonstrates navigation between static routes.

## Development

```sh
vp install
vp run dev:setup
vp run dev
```

The app's schema, views, and mutations live in `src/state.ts`. The project uses Void route types from `void prepare`. fate registers the client schema at runtime.

## Deployment

Build static files into `dist/client/` with `vp run build`. Serve that directory with a static host that resolves clean URLs to the corresponding HTML files.

To deploy directly to Cloudflare, run:

```sh
vp exec void deploy --platform cloudflare
```

Void deploys both pages as static assets. IndexedDB holds each browser's task data.
