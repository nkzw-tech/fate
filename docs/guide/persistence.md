# Persistence

fate can keep data across page reloads and save mutations while a user is offline. When they come back, their views can show previously loaded data and their pending changes continue where they left off.

## Client Setup

For a browser app, install the IndexedDB adapter:

```sh
vp add @nkzw/fate-indexeddb
```

Then pass `persistence` when creating the client:

```tsx
import { createIndexedDBStorage } from '@nkzw/fate-indexeddb';
import { createPersistence } from '@nkzw/fate/persistence';
import { createFateClient } from 'react-fate/client';

const fate = createFateClient({
  persistence: createPersistence({
    key: `workspace:${workspaceId}:user:${userId}`,
    storage: createIndexedDBStorage(),
  }),
  url: '/api/fate',
});
```

By default, fate saves loaded data for **one day**, with a storage budget of **25 MiB**. Use `maxAge` (milliseconds) and `maxBytes` to change those defaults:

```tsx
persistence: createPersistence({
  key: `workspace:${workspaceId}:user:${userId}`,
  maxAge: 3 * 24 * 60 * 60 * 1000,
  maxBytes: 50 * 1024 * 1024,
  storage: createIndexedDBStorage(),
}),
```

Create the client after you know which user is signed in. Use a different `key` for each account and workspace, matching the authenticated scope in your [server setup](#server-deduplication). When switching accounts, dispose the old persistence session and create a new client.

> [!NOTE]
>
> Persistence saves data. To load the app itself while offline, you'll also need a service worker for its HTML, JavaScript, and other assets.

## Cache Lifetime

You can keep a screen's data longer by passing `persist` to its request. For example, to save posts for three days:

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

The same option works with `fate.request(...)` and Vue's `useRequest`. Objects shared by several requests are saved once, and remain available while a saved request needs them.

`maxAge` starts when data is fetched successfully. Reading saved data does not extend it. Pass `persist: { maxAge: 0 }` to skip saving a request; other requests may still save data they share with it.

Saved data can outlive the [in-memory cache](/guide/requests#cache-lifetime). fate loads it when a request needs it, rather than restoring the whole cache at startup.

## Refreshing Data

Keeping data for three days doesn't mean waiting three days for updates. Request modes still control when to fetch fresh data. For example, to show saved posts immediately and refresh them in the background:

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

Use `cache-first` to fetch only missing data, or `network-only` to require a fresh response. Expiration affects saved data, not data already displayed by a mounted view. See [Request Modes](/guide/requests#request-modes) and [Live Views](/guide/live-views).

## Cache Size

When storage reaches `maxBytes`, fate removes expired data and the least recently used saved requests. Shared objects remain available while another saved request needs them.

Pending mutations are never evicted to make room for cached data. If a new mutation cannot fit, it fails before being applied optimistically or sent to the server. Already accepted mutations can still finish, even if their saved results temporarily exceed the budget.

## Actions & Mutations

With persistence configured, fate saves mutations before applying their optimistic updates or sending them to the server. The API is the same as for regular [Actions](/guide/actions):

```tsx
const [result, like] = useActionState(fate.actions.post.like, null);

like({
  input: { id: post.id },
  optimistic: { likes: post.likes + 1 },
});
```

If the user likes a post while offline, the count updates immediately. Reloading restores the pending action and its optimistic update. When the connection returns and the app is running, fate sends it to the server.

Mutations are delivered in the order they were saved, one at a time per persistence key. Tabs sharing a key coordinate delivery. Temporary failures are retried. Authentication failures wait for the user to sign in again. A terminal client error rolls back the optimistic update.

The mutation promise stays pending until confirmation, which can take until the user is back online. After a reload, use [Persistence State](#persistence-state) to show pending or failed changes.

### Skipping Persistence

For a call that should not be saved or retried, pass `persist: false`:

```tsx
await fate.mutations.analytics.record({
  input: { event: 'opened-settings' },
  persist: false,
});
```

The same option works with `fate.actions`.

### Creating Objects Offline

Use client-generated IDs when creating objects that later offline mutations depend on. For example, creating a comment and then editing it can use the same ID for both calls.

If the server assigns IDs, wait for the creation result before sending a dependent mutation. fate does not rewrite IDs inside mutation inputs or cancel later mutations when a creation fails.

Inputs and optimistic updates must be serializable. Functions, streams, and `File` objects cannot be queued. For uploads, save the content first and queue a reference to it, or use `persist: false`.

## Server Deduplication

A connection can fail after the server has applied a mutation. Retrying a lost response must not increment a like count twice.

fate gives each saved mutation an identity and reuses it on retries. Your server must save the result and the database changes in **the same transaction**, then return that result if the mutation arrives again.

For the native HTTP transport, use `createMutationIdempotency`:

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

Your app supplies the database and receipt helpers. Lock each `(scope, id)` across server processes, and use `ctx.db` for mutation writes so they share the receipt's transaction. See the [complete SQLite example](https://github.com/nkzw-tech/fate/blob/main/example/persistence/server.ts).

Keep receipts for as long as an offline client might retry. For effects outside the database, such as payments or emails, use the destination's idempotency support and a transactional outbox.

## tRPC, GraphQL, and Custom Transports

For other transports, provide `mutateDurably(name, input, select, identity)` with the same server deduplication. One option is to use a native fate endpoint alongside your existing backend:

```tsx
const durableHTTP = createHTTPTransport<MyAPI>({
  url: '/api/fate',
});

const fate = createFateClient({
  // ...your generated tRPC or GraphQL client options...
  persistence: createPersistence({ key: accountKey, storage: createIndexedDBStorage() }),
  mutateDurably: durableHTTP.mutateDurably,
});
```

Use the same authentication, mutation names, inputs, results, and IDs on both endpoints. A GraphQL adapter must decode global IDs and return the unwrapped result. It also receives selected field arguments as a fifth parameter; forward them when needed.

You can use the idempotency helper inside an existing resolver too:

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

Forward the entire identity on every attempt. When `identity.replayOnly` is true, the endpoint must return the saved result or a 404 without running the mutation. `createMutationIdempotency` handles this for you.

Without a durable adapter, saved reads and `persist: false` calls still work, but new durable mutations fail before being queued.

For GraphQL, return a standard `extensions.code` or numeric `extensions.http.status` for terminal client errors. Unrecognized execution errors remain retryable for saved mutations.

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

Each mutation exposes its ID, name, input, status (`queued`, `sending`, or `failed`), and last error. `getSnapshot()` also works with React's `useSyncExternalStore`.

A failed initial restore rejects `ready`. Storage errors appear in the snapshot. A cache read failure can fall back to the network, but a mutation that cannot be saved is not sent.

Read-cache writes are batched. Before a reload you control, call `flush()` to save the latest data:

```tsx
await session.flush();
window.location.reload();
```

Mutations are saved automatically before delivery. You can retry delivery or discard an unsent or failed mutation:

```tsx
session.retry();
await session.discard(mutationId);
```

`retry()` respects the retry delay. Once a mutation has been attempted, it cannot be discarded until its outcome is known: it may have committed on the server.

When leaving an account, dispose its session and unsubscribe:

```tsx
session.dispose();
unsubscribe();
```

Disposal stops delivery and removes optimistic updates from memory. Saved mutations remain available to the next client using the same key.

## Clearing Saved Data

To remove the saved read cache, call `clearCache()`:

```tsx
await fate.persistence!.clearCache();
```

This leaves in-memory data and queued mutations intact.

Change `hydrationScope` when deploying incompatible data models or mutation inputs. Incompatible saved reads are discarded; incompatible queued mutations remain visible as failures so the app can handle them.

## Other Storage Backends

To use storage other than IndexedDB, implement `PersistenceStorage`:

```ts
interface PersistenceStorage {
  read(key: string): Promise<unknown>;
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

Values can be stored as JSON. `scan` returns keys in ascending order after the optional cursor, up to the limit (64 by default). `writeBatch` must commit all entries atomically; `undefined` deletes a key.

`exclusive` coordinates tabs or processes sharing storage. Different lock names must be independent and allow nesting. `subscribe` notifies other clients after a write commits; without it, clients check during delivery and explicit retries.

The IndexedDB adapter requires a secure browser context with Web Locks. Browser storage can be cleared or evicted, so choose another backend if your app needs stronger retention.

Persistence coordinates delivery across tabs. Use refetching or [Live Views](/guide/live-views) to receive fresh server data.
