# Persistence

fate can keep data across page reloads and save mutations while a user is offline. When they come back, their views can show previously loaded data and their pending changes continue where they left off.

The same persistence setup can save [Client State](/guide/client-state#persisting-client-state), such as drafts or bookmarks. Client data stays saved when the remote cache expires or is cleared. You can use [migrations](/guide/client-state#migrations) to update its shape as your app changes.

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

Let's say a user wants to like a post while offline. With persistence and a [durable mutation transport](#server-deduplication) configured, fate saves the mutation before applying its optimistic update or sending it to the server. We can use the same API as for regular [Actions](/guide/actions):

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

Adding client fields or changing memo definitions doesn't invalidate queued remote mutations. Their recovery data contains remote fields, while saved client fields use [client-state migrations](/guide/client-state#migrations). If the remote schema scope changes or a mutation is removed, fate preserves its input as a failed entry instead of delivering an incompatible command.

### Waiting for Local Persistence

Sometimes we want to continue once a change is saved on the device, even if the user is offline. Each mutation promise has a `locallyPersisted` promise for this:

```tsx
const pending = fate.mutations.post.edit({
  input: { id: post.id, title },
  optimistic: { title },
});

void reportResult(pending);
await pending.locallyPersisted;
closeEditor();
```

Here, `reportResult` is the app's handler for the eventual mutation result, including returned errors and rejected promises. `locallyPersisted` resolves once storage has committed the mutation and the data needed to recover it after a reload. Awaiting `pending` still waits for server confirmation. A later server rejection doesn't change the completed local save.

For [client mutations](/guide/client-state#reading-and-updating-state), `locallyPersisted` waits for the client data to be saved. The same property is available when calling `fate.actions` directly, including actions bound with `.with()`.

If validation or storage fails before the save, `locallyPersisted` rejects. It also rejects when the call isn't persisted, including `persist: false`, missing persistence, or a remote mutation without durable delivery. Handle that failure before continuing with work that depends on the save. Waiting for one mutation doesn't make it atomic with a later mutation.

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

Keep receipts until their expiry, with a margin for clock differences. See [Receipt Retention](#receipt-retention) before deleting them. For effects outside the database, such as payments or emails, use the destination's idempotency support and a transactional outbox.

## Receipt Retention

Let's say a user likes a post, but closes the app before receiving the server response. When they return, fate retries the mutation with the same ID. The server reads its saved receipt and returns the result without adding another like.

By default, a queued mutation expires after **30 days**, including time spent offline. We can change this with `mutationMaxAge` on `createPersistence`. The server's `createMutationIdempotency` also defaults to 30 days through its `maxAge` option. To allow a longer lifetime, configure both sides.

The mutation ID includes its creation time and expiry. Retries and page reloads keep the same ID, so changing the configuration only affects new mutations. The server rejects mutations from a client clock more than five minutes ahead. A clock that is behind gives the mutation less time to reach the server.

### Cleaning Up Receipts

Save the receipt's optional `expiresAt` timestamp with its result. We can delete expired receipts once every server handling these mutations enforces expiry. Allow some extra time for differences between server clocks. For example, a daily job could delete receipts that expired more than a day ago.

This is why mutations have a fixed deadline. If we deleted a receipt while its mutation could still be retried, the server would have no way to know that it had already applied the change. Rejecting expired mutations lets us clean up receipts without applying the same mutation again.

Native HTTP delivery uses protocol version 3 for expiring mutations. Older native servers reject these requests before executing them. Custom durable transports must also enforce expiry and preserve the `MUTATION_EXPIRED` error (HTTP 410).

### Handling Expired Mutations

When a mutation expires, the server returns `MUTATION_EXPIRED`, even if its receipt has already been deleted. fate rolls back the optimistic update and keeps the input in persistence with `status: 'failed'` and `failureReason: 'expired'`.

For our like button, the server may have applied the like before the user closed the app. We should refresh the post before deciding whether to offer another attempt. fate doesn't assign a new ID or retry the expired mutation automatically. After handling the failure, call `session.discard(id)` to remove it from the queue.

Receipt deduplication allows at most one committed database execution for each mutation ID within its lifetime. It doesn't guarantee delivery, and effects outside the receipt transaction still need their own idempotency support.

### Existing Receipts

Older mutation IDs have no expiry. `createMutationIdempotency` accepts them by default, so their receipts need to stay saved. After retiring older clients, set `allowLegacyIdentities: false` to reject these mutations with the same expiry error. Once all server instances use that setting, their receipts can be deleted too.

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

To deliver durable mutations through your existing GraphQL route, set `durableMutations` without a custom `mutateDurably` adapter. Fate sends each listed mutation separately with `@fateDurable` on the operation and its identity in `extensions.fateMutation`. Install server support before enabling this option. Declare `directive @fateDurable on MUTATION` and have your execution middleware wrap the single mutation in `createMutationIdempotency`. Return the saved GraphQL result for receipt-only requests. A server that does not declare the directive rejects the operation during GraphQL validation.

For a custom GraphQL adapter that supports only some mutations, pass `durableMutations: ['setLocale', 'updateSettings']` alongside `mutateDurably`. Other mutations send immediately. Explicit `persist: true` fails for an unsupported mutation, and previously queued calls remain saved if the adapter stops supporting them. Omitting the list means the adapter supports every mutation.

You can use persistence for cached reads and client state before adding a durable mutation adapter. Server mutations send immediately by default in that setup. Pass `persist: true` when a call must be saved before delivery. It fails before sending if persistence or the adapter is missing.

Mutations that were already queued stay saved and report a delivery error until the adapter is available again.

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

This leaves in-memory data, queued mutations, and saved client state intact. For example, clearing cached posts keeps the bookmarks defined in your client schema.

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
