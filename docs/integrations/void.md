# Void Integration

`void-fate` is the [Void](https://void.cloud) adapter for fate. Deploy your app directly to your own Cloudflare account or to the Void platform with the same integration.

## New Project

For a new Void app, start from the Void template. It includes the client, Void routes, Drizzle setup, live transport, auth wiring, and generated fate client setup.

```sh
vp create fate -- --template void
```

Use Vue instead of React with:

```sh
vp create fate -- --template void --framework vue
```

## Existing Project

For an existing Void project, add the packages directly:

::: code-group

```sh [React]
pnpm add @nkzw/fate react-fate void-fate void @void/react
```

```sh [Vue]
pnpm add @nkzw/fate vue-fate void-fate void @void/vue
```

:::

## Vite

Use the framework adapter's Vite plugin with the Void transport:

::: code-group

```tsx [React]
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

```ts [Vue]
import { voidVue } from '@void/vue/plugin';
import { defineConfig } from 'vite-plus';
import { voidPlugin } from 'void';
import { fate } from 'vue-fate/vite';

export default defineConfig({
  plugins: [
    voidPlugin(),
    voidVue(),
    fate({
      module: './src/fate/server.ts',
      transport: 'void',
    }),
  ],
});
```

:::

The default routes are `/fate` for requests and `/fate-live` for live updates. Server rendering calls your fate server directly.

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

Pass `changed` to refresh only those fields, or omit it to refresh the whole selected view.

## Routes

Define a live stream once in a server-only module:

```ts
// src/fate/live.ts
import { defineLiveStream } from 'void/live';

export const fateStream = defineLiveStream({
  allowAnonymousControl: true,
  id: 'fate',
});
```

Add one route for fate RPC requests:

```tsx
// routes/fate.ts
import { defineVoidFateRoute } from 'void-fate/server';
import { fateStream } from '../src/fate/live.ts';
import { fateLive, fateServer } from '../src/fate/server.ts';

export const { GET, POST } = defineVoidFateRoute(fateServer, fateLive, {
  stream: fateStream,
});
```

Add a second route for the live SSE transport:

```tsx
// routes/fate-live.ts
import { defineVoidFateLiveRoute } from 'void-fate/server';
import { fateStream } from '../src/fate/live.ts';

export const { GET, POST } = defineVoidFateLiveRoute(fateStream);
```

## Layout

Wrap your app with the Void fate client for your framework. It creates and
provides the fate client through the matching adapter.

::: code-group

```tsx [React]
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

```vue [Vue]
<script setup lang="ts">
import { useShared } from '@void/vue';
import { computed } from 'vue';
import { FateClient } from 'vue-fate';
import { createFateClient } from 'vue-fate/client';
import type { SharedData } from '../src/lib/shared.ts';

const shared = useShared<SharedData>();

const fate = computed(() =>
  createFateClient({
    origin: typeof window === 'undefined' ? shared.origin : window.location.origin,
    userId: shared.auth.user?.id,
  }),
);
</script>

<template>
  <FateClient :client="fate">
    <slot />
  </FateClient>
</template>
```

:::

`userId` is optional, but passing it lets the client be recreated when the
signed-in user changes. Browser requests include credentials when a `userId` is
present.

## Custom Paths

The default route pair is `/fate` and `/fate-live`. If your Void app uses
different paths, update your route filenames and configure the matching client paths.

::: code-group

```tsx [React]
<VoidFateClient livePath="/custom-fate-live" origin={origin} rpcPath="/custom-fate" userId={userId}>
  {children}
</VoidFateClient>
```

```vue [Vue]
<script setup lang="ts">
const fate = computed(() =>
  createFateClient({
    livePath: '/custom-fate-live',
    origin,
    rpcPath: '/custom-fate',
    userId,
  }),
);
</script>

<template>
  <FateClient :client="fate">
    <slot />
  </FateClient>
</template>
```

:::

Make sure your route filenames match the paths passed to the client.

## Live Transport

Void distributes live updates across requests and connected clients. Missed events are not replayed after a reconnect.

## Cloudflare Deployment

From your project root, run:

```sh
vp exec void deploy --platform cloudflare
```

Void provisions resources and deploys directly to your Cloudflare account. See the [Cloudflare integration](/integrations/cloudflare) for setup and migration instructions.
