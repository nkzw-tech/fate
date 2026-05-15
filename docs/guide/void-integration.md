# Void Integration

`void-fate` is the first-class [Void](https://void.cloud) adapter for fate to ease integration with the Void SDK and for deploying to the Void platform.

Use this integration when your app runs on Void and you want the example app's
setup without copying its adapter glue.

## Install

```sh
pnpm add @nkzw/fate react-fate void-fate void
```

## Vite

Use the regular `react-fate` Vite plugin with the Void transport:

```tsx
import { voidReact } from '@void/react/plugin';
import { fate } from 'react-fate/vite';
import { defineConfig } from 'vite-plus';
import { voidPlugin } from 'void';

export default defineConfig({
  plugins: [
    voidPlugin(),
    voidReact(),
    fate({
      module: './src/fate/server.ts',
      transport: 'void',
    }),
  ],
});
```

The Void transport uses `/fate` for RPC requests and `/fate-live` for live
updates by default. In SSR, it calls the exported fate server directly. In the
browser, it uses fetch and the SSE live endpoint.

## Server Setup

Create a Void live adapter with `createVoidFateLive`, pass its `live` event bus
to `createFateServer`, and export the adapter next to your fate server.

```tsx
import { createFateServer } from '@nkzw/fate/server';
import { createDrizzleSourceAdapter } from '@nkzw/fate/server/drizzle';
import { createVoidFateLive } from 'void-fate/server';
import { db } from 'void/db';
import schema from '../db/schema.ts';
import { createContext } from './context.ts';
import { Root } from './views.ts';

const sources = createDrizzleSourceAdapter({
  db,
  schema,
  views: Root,
});

export const fateLive = createVoidFateLive();
export const { live } = fateLive;

export const fateServer = createFateServer({
  context: ({ request }) => createContext({ request }),
  live,
  roots: Root,
  sources,
});
```

Your app can publish live updates through the normal fate live bus:

```tsx
live.update('Post', postId, { changed: ['likes'] });
live.connection('Post.comments', { id: postId }).appendNode('Comment', commentId, {
  node: comment,
});
```

`changed` is optional. Void still uses generic topic fanout, while fate uses the changed field paths to refetch or write only the selected fields affected by the event.

## Routes

Add one route for fate RPC requests:

```tsx
// routes/fate.ts
import { defineVoidFateRoute } from 'void-fate/server';
import { fateLive, fateServer } from '../src/fate/server.ts';

export const { GET, POST } = defineVoidFateRoute(fateServer, fateLive);
```

Add a second route for the live SSE transport:

```tsx
// routes/fate-live.ts
import { defineVoidFateLiveRoute } from 'void-fate/server';
import { fateLive, fateServer } from '../src/fate/server.ts';

export const { GET, POST } = defineVoidFateLiveRoute(fateServer, fateLive);
```

The live route handles `GET /fate-live` SSE connections and `POST /fate-live`
control messages. `void-fate` does not use WebSockets.

## React Layout

Wrap your app with `VoidFateClient` from `void-fate/react`. It creates and
provides the fate client through `react-fate`:

```tsx
import { useShared } from '@void/react';
import type { ReactNode } from 'react';
import { VoidFateClient } from 'void-fate/react';
import type { SharedData } from '../src/lib/shared.ts';

export default function Layout({ children }: { children: ReactNode }) {
  const shared = useShared<SharedData>();
  const userId = shared.auth.user?.id;
  const origin = typeof window === 'undefined' ? shared.origin : window.location.origin;

  return (
    <VoidFateClient origin={origin} userId={userId}>
      {children}
    </VoidFateClient>
  );
}
```

`userId` is optional, but passing it lets `VoidFateClient` recreate the client
when the signed-in user changes. Browser requests include credentials when a
`userId` is present.

## Custom Paths

The default route pair is `/fate` and `/fate-live`. If your Void app uses
different paths, configure the same values on the live adapter and client.

```tsx
export const fateLive = createVoidFateLive({
  livePath: '/custom-fate-live',
});
```

```tsx
<VoidFateClient livePath="/custom-fate-live" origin={origin} rpcPath="/custom-fate" userId={userId}>
  {children}
</VoidFateClient>
```

The route helper does not own the route path. Make sure your Void route filename
or router configuration matches the paths you pass to the client.

## Live Transport

Void can run separate request handlers for mutations and long-lived SSE
connections. `createVoidFateLive` bridges those handlers by publishing live
events from the request that changed data to the live route.

In local development, `void-fate` uses a development token for that internal
publish request. Outside local development, Void must provide `__VOID_PROXY_TOKEN`
in the route environment. If no internal publish token is available, the adapter
falls back to the in-memory live bus for the current request context.

The live transport is best-effort and does not replay missed events after a
client reconnects. This matches fate's default in-memory live event bus.
