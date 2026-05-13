# void-fate

Void adapter for [fate](https://github.com/nkzw-tech/fate).

`void-fate` contains the server route helpers, SSE live transport, and React
client wrapper needed to use fate in a Void app without keeping adapter glue in
application code.

## Install

```sh
pnpm add @nkzw/fate react-fate void-fate void
```

## Vite

Use the regular `react-fate` Vite plugin with the Void transport.

```ts
import { fate } from 'react-fate/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    fate({
      module: './src/fate/server.ts',
      transport: 'void',
    }),
  ],
});
```

## Server

Create a Fate live publish facade and pass its `live` instance to the fate
server. Define the Void stream separately so `defineLiveStream` is called once
from a single server-only module.

```ts
// src/fate/live.ts
import { defineLiveStream } from 'void/live';

export const fateStream = defineLiveStream({
  allowAnonymousControl: true,
  id: 'fate',
});
```

```ts
// src/fate/server.ts
import { createFateServer } from '@nkzw/fate/server';
import { createVoidFateLive } from 'void-fate/server';

export const fateLive = createVoidFateLive();

export const fateServer = createFateServer({
  live: fateLive.live,
  // context,
  // roots,
  // sources,
});
```

## Routes

Add one route for RPC requests and one route for the SSE live transport.

```ts
// routes/fate.ts
import { defineVoidFateRoute } from 'void-fate/server';
import { fateStream } from '../src/fate/live.ts';
import { fateLive, fateServer } from '../src/fate/server.ts';

export const { GET, POST } = defineVoidFateRoute(fateServer, fateLive, {
  stream: fateStream,
});
```

```ts
// routes/fate-live.ts
import { defineVoidFateLiveRoute } from 'void-fate/server';
import { fateStream } from '../src/fate/live.ts';

export const { GET, POST } = defineVoidFateLiveRoute(fateStream);
```

The default paths are `/fate` for RPC and `/fate-live` for live updates.

## React

Use `VoidFateClient` in your app layout. The generated fate client is still
provided by the `react-fate` Vite plugin.

```tsx
import type { ReactNode } from 'react';
import { VoidFateClient } from 'void-fate/react';

export default function Layout({
  children,
  origin,
  userId,
}: {
  children: ReactNode;
  origin: string;
  userId?: string;
}) {
  return (
    <VoidFateClient origin={origin} userId={userId}>
      {children}
    </VoidFateClient>
  );
}
```

## Custom Paths

The defaults are intended to work without configuration. If your Void routes use
different paths, pass the same values to the server and client helpers.

```tsx
<VoidFateClient livePath="/custom-live" origin={origin} rpcPath="/custom-fate" userId={userId}>
  {children}
</VoidFateClient>
```

`void-fate` uses Server-Sent Events for live updates. It does not use
WebSockets.
