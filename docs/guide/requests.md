# Requests

## Requesting Lists

The `useRequest` hook can be used to declare our data needs for a specific screen or component tree. At the root of our app, we can request a list of posts like this:

```tsx
import { useRequest } from 'react-fate';
import { PostCard, PostView } from './PostCard.tsx';

export function App() {
  const { posts } = useRequest({ posts: { list: PostView } });
  return posts.map((post) => <PostCard key={post.id} post={post} />);
}
```

This component suspends or throws errors, which bubble up to the nearest error boundary. Wrap your component tree with `ErrorBoundary` and `Suspense` components to show error and loading states:

```tsx
<ErrorBoundary FallbackComponent={ErrorComponent}>
  <Suspense fallback={<div>Loading…</div>}>
    <App />
  </Suspense>
</ErrorBoundary>
```

> [!NOTE]
>
> `useRequest` may issue multiple operations in the same render pass. fate transports can batch those operations into fewer network requests: the native HTTP transport batches same-microtask operations into one `POST /fate` request, and the tRPC adapter can use tRPC's [HTTP Batch Link](https://trpc.io/docs/client/links/httpBatchLink).

## Requesting Objects by ID

If you want to fetch data for a single object instead of a list, you can specify the `id` and the associated `view` like this:

```tsx
const { post } = useRequest({
  post: { id: '12', view: PostView },
});
```

If you want to fetch multiple objects by their IDs, you can use the `ids` field:

```tsx
const { posts } = useRequest({
  posts: { ids: ['6', '7'], view: PostView },
});
```

## Other Types of Requests

For any other queries, pass only the `type` and `view`:

```tsx
const { viewer } = useRequest({
  viewer: { view: UserView },
});
```

## Request Arguments

You can pass arguments to `useRequest` calls. This is useful for pagination, filtering, or sorting. For example, to fetch the first 10 posts, you can do the following:

```tsx
const { posts } = useRequest({
  posts: {
    args: { first: 10 },
    list: PostView,
  },
});
```

Request arguments are part of the cache key. Two list requests for the same root with different filters or sorting arguments keep separate list state, and cursor arguments are merged into the same list when you load more pages. The selected view is part of the key as well: requesting `PostCardView` and `PostDetailView` can share normalized records, but fate still tracks whether the specific fields for each request are present.

## Request Modes

`useRequest` supports different request modes to control caching and data freshness. The available modes are:

- `cache-first` (_default_): Returns data from the cache if available, otherwise fetches from the network.
- `stale-while-revalidate`: Returns data from the cache and simultaneously fetches fresh data from the network.
- `network-only`: Always fetches data from the network, bypassing the cache.

You can pass the request mode as an option to `useRequest`:

```tsx
const { posts } = useRequest(
  {
    posts: { list: PostView },
  },
  {
    mode: 'stale-while-revalidate',
  },
);
```

## Timeouts and cancellation

Read requests accept an optional `timeout` in milliseconds and an `AbortSignal`:

```tsx
const result = useRequest(request, { timeout: 10_000 });
const refetch = useRefetch(request, { timeout: 10_000 });

const controller = new AbortController();
await client.request(request, { timeout: 10_000, signal: controller.signal });
// From another event handler: controller.abort();
```

The default has no deadline. A timeout rejects with an error named `TimeoutError`;
external cancellation rejects with `signal.reason` (normally an `AbortError`).
The deadline starts when the read starts, includes persistence initialization,
and stays fixed across equivalent Suspense rerenders. Use a stable signal when
passing one to a hook. An already-aborted signal prevents a new fetch.

Each imperative caller has its own deadline. Identical pending reads can share
work, but cancelling one caller keeps that work alive for the others. Batched HTTP
and GraphQL requests abort their shared fetch only when every operation cancels.
Cancelled operations cannot write late network results to the cache. Custom
transports receive the signal in their optional read context and should forward
it to their network implementation; fate still rejects and ignores their late
results if they do not support cancellation. The tRPC adapter passes the signal
in the resolver's second argument, matching tRPC query options.

`useRequest` sends initial failures to your error boundary. Handle errors from
`useRefetch` or `client.request` in the calling event handler; these failures
preserve existing data. An explicit retry starts a new deadline. The same options
work with `useRequestState`, `client.observeRequest`, and Vue `useRequest`.
For `stale-while-revalidate`, cached data returns immediately while the deadline
bounds the background refresh. These controls apply to the request's initial
reads; later view reads, deferred fields, pagination, live streams, and mutations
have separate lifetimes and do not inherit them.

## Cache Lifetime

fate stores records in a normalized cache keyed by `__typename` and `id`. Lists and root queries point at those records, and views read from the normalized cache. When a `useRequest` call is mounted, fate retains the request so the records and lists needed by that screen stay in memory. When the component unmounts, the request is released and fate schedules garbage collection.

Released requests are kept in a small release buffer before their data becomes collectible. This makes common route transitions cheap: navigating away from a screen and quickly coming back usually reuses the cached records instead of refetching them. The default release buffer stores the 10 most recently released requests.

You can tune the buffer when creating the client:

```tsx
const fate = createClient({
  gcReleaseBufferSize: 20,
  roots,
  transport,
  types,
});
```

Set `gcReleaseBufferSize` to `0` in tests or very memory-sensitive environments when released screens should be collected immediately.

`cache-first` request handles are stable while their request is cached. If garbage collection later removes the data for a fulfilled request, the next `cache-first` request automatically fetches it again rather than returning stale references.

If you call `fate.request(...)` outside React and need the result to stay in memory across manual `gc()` calls, retain the same request for the lifetime of that work:

```tsx
const request = { posts: { list: PostView } };
const retained = fate.retain(request);

try {
  const { posts } = await fate.request(request);
  // Use posts while this request is retained.
} finally {
  retained.dispose();
}
```

Garbage collection waits for active optimistic updates to settle before sweeping records. This keeps temporary optimistic records and their list positions stable while mutations are still pending.

## SSR and Hydration

Create a request-scoped fate client on the server, preload the route data, and dehydrate its normalized cache:

```tsx
const fate = createFateClient();
await fate.request({ post: { id: '12', view: PostView } });

return {
  fate: fate.dehydrate(),
};
```

Transport the returned value through your framework's loader serialization, React Server Component props, or a safely escaped JSON bootstrap script. The snapshot contains plain serializable values, so serializers such as Seroval can carry it without fate-specific integration. Treat the snapshot as opaque: hydrate it through fate rather than reading or editing its internal data.

On the browser, hydrate the new client before rendering components that call `useRequest`:

```tsx
const fate = createFateClient();
fate.hydrate(loaderData.fate);

hydrateRoot(
  document,
  <FateClient client={fate}>
    <App />
  </FateClient>,
);
```

Hydrated `cache-first` requests resolve from the normalized cache without refetching. Hydration restores records, selected-field coverage, root queries, and list pagination state. It intentionally does not restore active requests, subscriptions, retainers, timers, or optimistic mutation state.

Snapshots carry a hydration scope and are rejected by clients with a different scope. Generated clients set a stable scope automatically. When constructing a client directly, pass `hydrationScope` and rotate it when deploying an incompatible cache schema or when separating cache namespaces:

```tsx
const fate = createClient({
  hydrationScope: 'storefront-v2',
  // ...
});
```

Use `hydrationLimits` when an application needs stricter bootstrap payload limits. fate applies conservative defaults for total encoded values, collection sizes, and string lengths.

By default, hydration preserves values already present in the browser cache while adding missing server data. Pass `{ merge: 'replace' }` only when the snapshot should authoritatively reset the durable cache:

```tsx
fate.hydrate(loaderData.fate, { merge: 'replace' });
```

`preserve-existing` recursively combines plain scalar objects while keeping browser values on conflicts. Arrays, dates, entity references, and list windows are atomic: an existing browser value wins as a whole. Replaying a snapshot is safe and does not notify subscribers when durable cache state is unchanged.

Do not reuse request-scoped snapshots across users. Dehydrate after awaited route preloading: snapshots are point-in-time values and do not stream cache patches for data that resolves later. Hydration and dehydration reject clients with in-flight requests, so hydrate the initial snapshot before rendering.

## Observing Request State

React's `useRequestState(request, options)` observes a request without suspending.
It returns `status`, `data`, `error`, and `isFetching`. Status is `pending`, `ready`,
or `error` for an enabled network request. An initial failure exposes the original
error rather than throwing during render. Request data contains the same refs as
`useRequest`; resolve them with `useView`.

Use `{ enabled: false }` for an empty search or an inactive screen. The status is
`disabled`, data is undefined, and no request starts. Changing `enabled` to true
starts the request. Equivalent inline request objects do not cause repeat fetches.

Use `{ mode: 'cache-only' }` to observe already-cached data. A complete selection
has status `ready`; an incomplete selection has status `missing` and undefined
data. A successful nullable root remains `ready` with a null value. Cache-only
requests never fetch, and their view refs cannot fetch missing fields either.
Mounted observers retain their request's records until unmount.

Outside React, `client.observeRequest(request, options)` exposes `getSnapshot()`
and `subscribe(listener)`. The first subscriber starts an enabled request;
unsubscribing releases its retention. Reading a snapshot alone never starts work.

Every request state includes a stable `refetch()` function. It forces a network
request, returns a promise for the completed result, and rejects with the original
error on failure. Concurrent calls share pending work. During refresh, complete
cached data stays available with `status: 'ready'` and `isFetching: true`. A failed
refresh keeps that data and exposes `error`; the next attempt clears the error.
`stale-while-revalidate` observers track the entire background request the same
way, including failures. Disabled and cache-only observers reject explicit
refetches without fetching; enable the request or change its mode first.

```ts
const state = useRequestState(request, { mode: 'stale-while-revalidate' });
// Render state.data, state.isFetching, and state.error independently.
await state.refetch(); // Also usable from a refresh button or retry action.
```

Overlapping reads use their network start order when normalizing responses. An
older response cannot overwrite a field already supplied by a newer response or
a later confirmed write. It may still fill other fields. Root results and list
replacements also retain the newer result. Optimistic layers remain visible over
incoming confirmed data; rolling them back reveals that data, while committing a
mutation protects its confirmed fields from older requests.

### Aliases

Use `alias(sourceField, selection)` to select one schema field under multiple
result names, with independent arguments:

```ts
const GamesView = view<User>()({
  activeGames: alias('games', {
    args: { first: 20, status: 'Active' },
    items: { node: GameView },
    pagination: { hasNext: true, nextCursor: true },
  }),
  waitingGames: alias('games', {
    args: { first: 20, status: 'Waiting' },
    items: { node: GameView },
  }),
  displayName: alias('name', true),
});

const request = { currentUser: alias('viewer', { view: GamesView }) };
```

Source fields, nested selections, result types, and generated root argument
contracts remain checked. Alias names affect the returned shape; normalized
identity uses the source field and its arguments. An ordinary selection with the
same arguments shares the cached data. Connection filters identify separate
cache slots and pagination state. Conflicting response names or arguments in a
composed view fail during planning. `id` and `__typename` are reserved result
names because fate needs them for entity identity.

GraphQL emits native aliases, including inside mutation selections, so multiple
variants execute in one operation. Native HTTP, tRPC, and custom transports
receive compatible reads with ordinary schema field names; conflicting variants
may require multiple reads or subscriptions. These fallback reads are independent
server operations. A mutation that needs multiple variants requires native alias
support and otherwise rejects before executing. A simple rename is lowered for
native mutations without repeating the action.

Custom transports can set `supportsAliases: true` to handle the full selection in
one operation. Selection path segments and corresponding argument keys then use
`resultName:schemaField`, and returned records must use those same encoded keys.
GraphQL performs that conversion automatically. Applications consume the declared
result names, never the encoded transport names.

## Imperative refresh with Suspense

In React, use `useRefetch` alongside `useRequest` to refresh the same request from
an event handler without changing the Suspense hook's return value:

```tsx
import { useRefetch, useRequest } from 'react-fate';

const request = { viewer: { view: UserView } };
const { viewer } = useRequest(request);
const refetch = useRefetch(request);

// In an event handler or React Action:
await refetch();
```

Calling the hook does not fetch or subscribe. Its callback forces a network
request and returns its typed result, rejecting on failure so the caller can
handle the error. Existing cached data stays available while refreshing. Cache
updates notify subscribed views and requests, including changed root results.
Equivalent inline requests preserve the callback's identity. The optional second
argument accepts `persist` options; the request mode is always `network-only`.
Entity refreshes use the configured refetch query when one exists, across transports.
