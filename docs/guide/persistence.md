# Persistence

fate can optionally keep data available across page reloads and save mutations while a user is offline. When the user comes back, their views can show previously loaded data and their pending changes continue where they left off.

Persistence builds on fate's normalized cache, [Requests](/guide/requests), and [Actions](/guide/actions). You configure storage only once, without changing how you use fate.

## Client Setup

The persistence layer is part of `@nkzw/fate`, with storage adapters installed separately. For a browser app using IndexedDB, add the adapter:

```sh
vp add @nkzw/fate-indexeddb
```

Then pass `persistence` when creating the client:

```tsx
import { createPersistence } from '@nkzw/fate/persistence';
import { indexedDB } from '@nkzw/fate-indexeddb';
import { createFateClient } from 'react-fate/client';

const fate = createFateClient({
  persistence: createPersistence({
    key: `workspace:${workspaceId}:user:${userId}`,
    storage: indexedDB(),
  }),
  url: '/api/fate',
});
```

By default, fate keeps loaded data for **one day**, with a storage budget of **25 MiB**. You can change both values:

```tsx
persistence: createPersistence({
  key: `workspace:${workspaceId}:user:${userId}`,
  maxAge: 24 * 60 * 60 * 1000,
  maxBytes: 25 * 1024 * 1024,
  storage: indexedDB(),
}),
```

Create the browser client after you know which user is signed in. The `key` separates saved data and mutations by account and workspace, and must match the authenticated scope in the [server setup](#server-deduplication). When switching accounts, dispose the previous persistence session and create a new client with the new account's key.

> [!NOTE]
>
> Persistence saves your app's data. To load the app itself while offline, you'll also need a service worker that makes its HTML, JavaScript, and other assets available. fate does not install a service worker or download pages the user hasn't visited.

## Cache Lifetime

You can keep the data for a specific screen longer by passing `persist` to `useRequest`. For example, to keep a list of posts for three days:

```tsx
const { posts } = useRequest(
  {
    posts: { list: PostView },
  },
  {
    persist: { maxAge: 3 * 24 * 60 * 60 * 1000 },
  },
);
```

The same option works with `fate.request(...)` and Vue's `useRequest`. If a screen uses several requests, set the option on each request whose data you want to keep longer.

fate stores objects by their type and ID, just like the in-memory cache. If a post appears in both your feed and a detail screen, both requests share the same saved post. Each request describes which fields and related objects it needs, including list membership and pagination state.

For example, your feed might keep posts for one day, while the detail screen keeps them for three days. After one day, the fields needed by the detail screen remain available. Fields selected only by the feed can be removed. You don't need to coordinate separate copies of the same post or manually patch each request's cache.

`maxAge` is measured in milliseconds from when the data was fetched successfully. Reading saved data or rendering the screen again does not restart that lifetime. If a request fetches one missing post, it only renews the data it fetched. Other posts already in the cache keep their original age. Changing a cached request's `maxAge` also uses the original fetch time.

When callers share a pending request, the latest explicit `persist.maxAge` also applies to that request's eventual cache write.

Pass `persist: { maxAge: 0 }` to skip saving data for a request. Shared objects may still be saved for other requests, so this option does not delete all copies of an object.

The [in-memory garbage collector](/guide/requests#cache-lifetime) continues to work independently. A post can be removed from memory while its saved copy remains available for a later visit. On startup, fate restores pending mutations, then loads saved data as requests need it. It does not load the entire saved cache into memory.

## Refreshing Data

Keeping data for three days doesn't mean waiting three days for updates. You can use the existing [request modes](/guide/requests#request-modes) to choose when to fetch fresh data:

- `cache-first` (_default_): Uses available saved data and fetches missing data from the network.
- `stale-while-revalidate`: Shows saved data and refreshes it in the background. If the refresh fails, the saved data stays visible.
- `network-only`: Requires a network response, even if saved data is available.

For example, to show the previous session's posts immediately and update them on reload:

```tsx
const { posts } = useRequest(
  {
    posts: { list: PostView },
  },
  {
    mode: 'stale-while-revalidate',
    persist: { maxAge: 3 * 24 * 60 * 60 * 1000 },
  },
);
```

Expiration controls how long data stays in storage. It does not remove data from a mounted view or change the in-memory fetch policy. For ongoing server updates, use [Live Views](/guide/live-views).

## Cache Size

When saved data reaches `maxBytes`, fate removes expired data first, then releases the least recently used requests until the new data fits. Objects still needed by another saved request remain available, and shared objects count toward the budget only once. A response that is too large to save can still be used in memory without removing other saved requests to make room for it.

The budget includes encoded data, keys, cache metadata, and the saved mutation queue. Your storage backend may use additional space for its own bookkeeping. `maxBytes` controls saved data; the existing garbage collector controls the lifetime of data in memory.

fate batches cache writes and yields during large traversals and writes so other work on the page can continue. The mutation journal stores each entry separately and writes only changed entries, so confirming a mutation does not rewrite the entire queue. Changes to scalar fields write the affected record, while changes to relationships also update the saved data that depends on them.

Pending mutations are never removed to make room for cached data. If a new mutation cannot fit, it fails before fate applies its optimistic update or sends it to the server.

> [!NOTE]
>
> Already accepted mutations must still be able to finish. Their recovery data and saved results can exceed the budget if they grow or you lower `maxBytes`. In that case, fate releases the read cache and rejects new durable mutations until capacity is available. Local confirmation receipts count toward the budget until their cache changes have been saved. fate then removes them automatically, making room for new mutations.

## Actions & Mutations

With persistence configured, fate saves actions and mutations locally before applying their optimistic updates or sending them to the server. The API is the same as for regular [Actions](/guide/actions):

```tsx
const [result, like] = useActionState(fate.actions.post.like, null);

like({
  input: { id: post.id },
  optimistic: { likes: post.likes + 1 },
});
```

If the user likes a post while offline, the like count updates immediately. Reloading the page restores the pending action and its optimistic update. When the connection returns and a client is running, fate sends the action to the server and updates the post with the confirmed result.

Mutations from one client are saved in invocation order and sent in the order they were saved, one at a time for each persistence key. Tabs sharing that key coordinate delivery. Temporary network and server failures are retried with increasing delays, up to 30 seconds between attempts. Authentication failures stay pending so delivery can resume after the user signs in again. A terminal client error rolls back the optimistic update and follows fate's existing [error handling](/guide/actions#action--mutation-error-handling).

The mutation promise resolves after remote confirmation has been saved locally. It can remain pending while offline. Closing the page loses the JavaScript promise, but the saved mutation and optimistic update remain. After a reload, use the [persistence state](#persistence-state) to show pending and failed changes.

### Skipping Persistence

For a call that should run immediately without being saved or retried, pass `persist: false`:

```tsx
await fate.mutations.analytics.record({
  input: { event: 'opened-settings' },
  persist: false,
});
```

The same option works with `fate.actions`. A successful result can still update the normal cache. Without persistence configured, actions and mutations keep their existing behavior.

### Creating Objects Offline

Use a stable, client-generated ID when creating an object offline. For example, a new comment and a later edit to that comment can use the same ID, allowing fate to send the creation before the edit when the user reconnects.

If your server assigns IDs, wait for the creation result before constructing a dependent mutation. fate does not rewrite arbitrary foreign keys inside saved inputs. A failed creation also does not automatically cancel later mutations; your server should validate them as usual.

Mutation inputs and optimistic updates must be serializable with fate's hydration codec. Functions, streams, and `File` objects cannot be queued. For uploads, save the content first and queue a reference to it, or use `persist: false` for the upload itself.

## Server Deduplication

A connection can fail after the server has already applied a mutation. For example, the server might increment a post's like count, but the response never reaches the browser. Retrying that mutation without server support would increment the count twice.

fate assigns an identity to each saved mutation and reuses it on every attempt. The server records the result alongside the mutation's database changes, in **the same transaction**. When the same mutation arrives again, the server returns the saved result.

For the native HTTP transport, configure `createMutationIdempotency` on your server. The following example uses application-provided helpers to lock a mutation identity and read or insert its receipt:

```ts
import { createMutationIdempotency } from '@nkzw/fate/persistence/server';
import { createFateServer } from '@nkzw/fate/server';

const server = createFateServer({
  // ...roots, sources, mutations, context...
  idempotency: createMutationIdempotency({
    scope: (ctx) => `workspace:${ctx.workspace.id}:user:${ctx.user.id}`,
    store: {
      transaction: (ctx, scope, id, run) =>
        database.transaction(async (tx) => {
          await lockMutationIdentity(tx, scope, id);
          return run({
            context: { ...ctx, db: tx },
            read: () => readReceipt(tx, scope, id),
            write: (receipt) => insertReceipt(tx, scope, id, receipt),
          });
        }),
    },
  }),
});
```

Your app supplies `database`, `lockMutationIdentity`, `readReceipt`, and `insertReceipt`. The lock must serialize attempts with the same `(scope, id)` across server processes, including the first attempt before a receipt exists. Mutation resolvers must use the transaction's `ctx.db`, so their changes and the receipt commit together. A unique index on the receipt table alone cannot protect changes made outside that transaction.

See [`example/persistence/server.ts`](https://github.com/nkzw-tech/fate/blob/main/example/persistence/server.ts) for a complete SQLite implementation, including the receipt table and transaction handling.

The helper checks the identity against the authenticated scope and rejects reuse with different mutation names, inputs, or selections. Server receipts do not expire: a user might reconnect much later with a mutation whose response was lost. Keep receipts for as long as an old mutation could still arrive.

A database transaction cannot roll back an email, payment, or webhook sent to another service. For those effects, use a transactional outbox and the destination's idempotency support. The transaction integration guarantees one committed database effect; network requests and resolver attempts can still happen more than once.

Native HTTP sends durable mutations and receipt-only recovery using protocol version 2, so older servers reject unsupported requests before executing them. Ordinary requests and live subscriptions continue to use version 1. A current server without the idempotency integration also rejects durable mutations before running their resolvers.

## tRPC, GraphQL, and Custom Transports

For tRPC, GraphQL, or a custom transport, provide a `mutateDurably(name, input, select, identity)` method that sends the identity to an endpoint with server deduplication. Regular calls continue to use `mutate(name, input, select)`.

Both `createTRPCTransport` and `createGraphQLTransport`, including their generated clients, accept `mutateDurably`. For example, you can use a native fate endpoint for durable mutations alongside your existing transport:

```tsx
const durableHTTP = createHTTPTransport<MyAPI>({
  url: '/api/fate',
  // Use the same authenticated headers as your other transport.
});

const fate = createFateClient({
  // ...your generated tRPC or GraphQL client options...
  persistence: createPersistence({ key: accountKey, storage: indexedDB() }),
  mutateDurably: durableHTTP.mutateDurably,
});
```

Both endpoints need to agree on mutation names, inputs, results, and entity IDs. A custom GraphQL adapter should unwrap its response and decode GraphQL global IDs before returning data to fate.

You can also use the same idempotency helper inside an existing tRPC or GraphQL resolver. Validate the input and identity at the endpoint, then pass them to `execute`:

```ts
return idempotency.execute({
  ctx,
  identity: input.identity,
  input: input.update,
  name: 'post.update',
  select: input.select,
  resolve: (transactionContext) => updatePost(transactionContext, input.update),
});
```

The adapter must pass the entire identity on every attempt, including `replayOnly` when present. With `replayOnly: true`, the endpoint must return the existing receipt or a 404 if none exists, without executing the mutation. `createMutationIdempotency` handles both delivery and receipt-only recovery. Adding an identity to a header that the server ignores does not prevent duplicate effects.

If a client has registered mutations but no durable adapter, the persistence session reports a configuration error. Saved reads and `persist: false` calls still work. New durable calls fail before being queued, and existing queued mutations stay saved until a client with the adapter can deliver them.

## Persistence State

Use `fate.persistence` to observe pending changes and storage errors:

```tsx
const session = fate.persistence!;
await session.ready;

const unsubscribe = session.subscribe(() => {
  const { status, error, mutations } = session.getSnapshot();
  // Show pending changes or report a storage error.
});
```

`getSnapshot` returns a stable value between updates and can be used with React's `useSyncExternalStore`. The same subscription API works with Vue. Each mutation exposes its ID, name, input, status (`queued`, `sending`, or `failed`), and last error.

A failed initial restoration rejects `ready`. Storage errors also appear in the snapshot. If reading the saved cache fails, fate can still fetch the data from the network. If saving a new mutation fails, the call rejects before it is sent.

Cache writes are batched. To save the latest read cache before a reload you control, call `flush()`:

```tsx
await fate.persistence!.flush();
window.location.reload();
```

A failed cache write keeps its pending data for a later `flush()` retry. Mutations are saved individually before delivery and do not depend on a delayed cache write or a page-unload event. On confirmation, fate saves the receipt, its confirmed cache changes, and the remaining mutations' recovery data together before resolving the call. Saving the read cache separately means a cache write failure cannot block an already confirmed mutation. The receipt and confirmed cache changes remain in the journal until the read cache checkpoint succeeds, then fate removes them. A tab that missed the confirmation recovers its result from the server receipt when it reconnects. This lookup cannot execute a discarded mutation. After a restart, fate repairs those changes before serving saved reads; if storage is still unavailable, reads fall back to the network instead of returning stale saved data.

You can also retry delivery or discard a mutation:

```tsx
session.retry();
await session.discard(mutationId);
```

`retry()` respects the saved retry deadline. `discard()` removes an unsent mutation or a terminal failure. A mutation that was already attempted cannot be discarded while its result is unknown: it may have committed remotely, and fate must recover that result first.

When leaving an account, dispose its session and unsubscribe:

```tsx
session.dispose();
unsubscribe();
```

Disposing stops that client's delivery, rejects its pending promises, and removes its optimistic updates from memory. Saved mutations remain available to the next client using the same key. Responses arriving after disposal cannot update the old client's cache.

## Clearing Saved Data

To remove the saved read cache, call `clearCache()`:

```tsx
await fate.persistence!.clearCache();
```

This leaves current in-memory data, queued mutations, and their recovery data intact. Confirmation receipts waiting for a cache checkpoint also remain available; fate removes them after a successful checkpoint.

For a complete local account reset, stop every client using the key before removing its journal header, individual mutation entries, and namespaced cache entries from storage. This also removes unsent changes. It cannot undo mutations that already ran on the server.

Saved data carries the client's [hydration scope](/guide/requests#ssr-and-hydration). An incompatible read cache is discarded, while incompatible queued mutations are kept as failures for inspection. Change `hydrationScope` when deploying incompatible cache schemas or changing the meaning of mutation inputs. An unknown or corrupt mutation journal blocks restoration and is left untouched so the saved work can be recovered.

## Other Storage Backends

The core persistence layer has no IndexedDB dependency. You can use another backend by implementing `PersistenceStorage`:

```ts
interface PersistenceStorage {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
  scan(
    prefix: string,
    after?: string,
    limit?: number,
  ): Promise<Array<{ key: string; value: unknown }>>;
  writeBatch(entries: ReadonlyArray<readonly [string, unknown]>): Promise<void>;
  exclusive<T>(key: string, run: () => Promise<T>): Promise<T>;
  subscribe?(key: string, listener: () => void): () => void;
}
```

Values use fate's hydration codec and can be stored as JSON. The adapter handles storage and coordination:

- `read` returns the saved value for a key.
- `write` replaces one value atomically and resolves after it has committed.
- `scan` returns keys under a prefix in ascending order, strictly after the optional cursor, up to the limit (64 by default). Use your backend's ordered index to keep each scan small.
- `writeBatch` commits all entries atomically. An `undefined` value deletes the key.
- `exclusive` coordinates every tab or process sharing the backend. Different lock names are independent: fate holds a delivery lock during network work and acquires a separate write lock when updating storage. Your adapter must allow that nesting.
- `subscribe` notifies other clients after a change commits, including keys changed by `writeBatch`. Without notifications, clients check saved mutations during delivery attempts and explicit `retry()` calls.

The IndexedDB adapter implements this with `idb`, IndexedDB transactions, Web Locks, and BroadcastChannel. It requires a secure browser context with Web Locks. Browser storage can still be cleared or evicted; if your app needs stronger retention, request persistent browser storage or choose another backend.

Persistence coordinates mutation delivery across tabs, but it does not keep every tab's read cache synchronized or resolve application conflicts. Use refetching or [Live Views](/guide/live-views) to receive fresh server data.
