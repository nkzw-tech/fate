# Client State

**_fate_** can manage client state alongside data from your server. For example, you might want to keep a bookmark on a post, save a draft, or share a selection between components. You can also build an app entirely with client state.

Client state uses the same [Views](/guide/views), [Requests](/guide/requests), and [Actions](/guide/actions) as server data. Components declare which fields they need, and fate updates them when those fields change. A view can select client and server fields together, so components don't need to know where each field comes from.

## Client Setup

Let's start with a counter that we want to share between two components. We define its fields with `dataView`, then use `clientSchema` to give it an initial value and make it available through a root:

```ts
import { clientSchema, createClient, dataView, type EntityOf } from 'react-fate';

const counter = dataView<{ id: string; value: number }>('Counter')({
  id: true,
  value: true,
});

const schema = clientSchema({
  roots: { counter: { id: 'main', type: 'Counter' } },
  types: {
    Counter: { defaults: (id) => ({ id, value: 0 }), view: counter },
  },
});

export const createAppClient = () =>
  createClient().registerClientSchema(schema, ({ mutation }) => ({
    'counter.increment': mutation('Counter', {
      resolve: ({ store }) =>
        store.update('Counter', 'main', {
          value: (store.get('Counter', 'main')?.value ?? 0) + 1,
        }),
    }),
  }));

export type AppClient = ReturnType<typeof createAppClient>;
export type Counter = EntityOf<AppClient, 'Counter'>;

declare module '@nkzw/fate' {
  interface ClientRegistration {
    client: AppClient;
  }
}
```

The `counter` root refers to a `Counter` with ID `main`. Its `defaults` function gives it an initial value of `0`. The `counter.increment` mutation reads the current value and increases it by one.

`registerClientSchema` adds these definitions to the client and returns the same instance with the updated types. Call it before making requests or writing data. `ClientRegistration` makes those types available to the hooks, and `EntityOf` gives us the `Counter` type for our views. In a monorepo, keep each app's registration in its own TypeScript project.

Now we can pass the client to the `FateClient` provider and render two counter panels:

```tsx
import { Suspense } from 'react';
import { FateClient } from 'react-fate';
import { CounterPanel } from './CounterPanel.tsx';
import { createAppClient } from './state.ts';

const fate = createAppClient();

export function App() {
  return (
    <FateClient client={fate}>
      <Suspense fallback={<p>Loading…</p>}>
        <CounterPanel />
        <CounterPanel />
      </Suspense>
    </FateClient>
  );
}
```

This app runs entirely in the browser. It doesn't need a transport, fate's Vite plugin, or code generation. The definition helpers are shared with `@nkzw/fate/server` and are also available from `@nkzw/fate` and `vue-fate`. You can use the same definitions in a Vue app with the [Vue provider and hooks](/guide/vue).

## Reading and Updating State

Now that we have defined the counter, let's build `CounterPanel`. We select the counter's `value`, request it with `useRequest`, and read it with `useView`:

```tsx
import { useFateClient, useRequest, useView, view } from 'react-fate';
import type { Counter } from './state.ts';

const CounterView = view<Counter>()({ value: true });

export function CounterPanel() {
  const fate = useFateClient();
  const { counter } = useRequest({ counter: { view: CounterView } });
  const data = useView(CounterView, counter);

  return (
    <button type="button" onClick={() => fate.mutations.counter.increment()}>
      Count: {data.value}
    </button>
  );
}
```

Both panels refer to the same counter. Clicking either button increments its value and re-renders both components. As with server data, a component only re-renders when a field selected by its view changes.

Our mutation doesn't take any input, so we can call `fate.mutations.counter.increment()` without arguments. We can still pass options, such as `{ view: CounterView }`. Mutations that declare input fields require an `input` object, even when all of those fields are optional.

Without persistence, synchronous client mutations update the data immediately, before their returned promise settles. With [persistence](#persisting-client-state), fate saves the changes before making the confirmed state available to views.

You can also use `fate.actions.counter.increment` with React's `useActionState`. Dispatch it with `increment({})`, or pass options such as `increment({ view: CounterView })`. See [Actions](/guide/actions).

### Reading Without Suspense

Let's say we want our counter panel to show a placeholder when its data isn't available, without suspending. In React, we can pass `mode: 'cache-only'` to `useRequest`:

```tsx
export function CachedCounterPanel() {
  const result = useRequest({ counter: { view: CounterView } }, { mode: 'cache-only' });
  const data = useView(CounterView, result?.counter);

  if (!data) {
    return <p>Counter data is not available yet.</p>;
  }

  return <span>Count: {data.value}</span>;
}
```

The request returns `undefined` when the selected data is missing. We pass the optional ref to `useView` before checking the result, so both hooks run on every render. The panel updates when a mutation or persistence restoration supplies the data. For a root that looks up a task by ID, the root returns `null` when no task matches.

With `cache-only`, fate reads the cached data without fetching missing server fields or suspending. The default is still `cache-first`, which can suspend while restoring saved data or loading a server relationship. Wrap the panel in `Suspense` to show a loading state while keeping the rest of the app visible. See [Request Modes](/guide/requests#request-modes).

### Synchronous Reads Outside Components

We can also read the counter outside a component. For example, a keyboard handler can use `peekView` to read its current value synchronously:

```ts
const ref = fate.ref('Counter', 'main', CounterView);
const snapshot = fate.peekView(CounterView, ref);
const value = snapshot?.data.value;
```

`peekView` returns the same snapshot as `readView`, including computed fields and optimistic updates. If the object or selected fields are missing, or persistence isn't ready, it returns `undefined`. It reads from memory without fetching or restoring saved data. The same method works with cached server data and relationships.

A peek doesn't subscribe to changes or keep the object in memory. Deferred fields stay deferred, and invalid refs or errors in a computation still throw. Use `await fate.readView(CounterView, ref)` when we want to load missing data.

## Typed Mutation Helpers

Let's move our counter's increment into a separate function. We can use `ClientStore` to type its store parameter and `ClientMutationBuilder` to define the mutations outside `registerClientSchema`:

```ts
import type { ClientMutationBuilder, ClientStore } from 'react-fate';

type Empty = Record<never, never>;
type CounterStore = ClientStore<{ Counter: Counter }, typeof schema>;
type Builder = ClientMutationBuilder<Empty, Empty, typeof schema>;

const increment = (store: CounterStore) =>
  store.update('Counter', 'main', {
    value: (store.get('Counter', 'main')?.value ?? 0) + 1,
  });

const defineMutations = ({ mutation }: Builder) => ({
  'counter.increment': mutation('Counter', {
    resolve: ({ store }) => increment(store),
  }),
});
```

`CounterStore` describes the counter records our helper can read. The schema determines which fields it can change. The builder's first two type parameters describe existing roots and mutations. Our app has no server data, so we pass empty records for both.

These types, along with `ClientMutationContext` for the full resolver context, are available from `@nkzw/fate`, `react-fate`, and `vue-fate`.

If we want to give `createAppClient` an explicit return type, we can use `ClientOf`:

```ts
import type { ClientOf } from 'react-fate';

type AppClient = ClientOf<typeof schema, ReturnType<typeof defineMutations>>;

export const createAppClient = (): AppClient =>
  createClient().registerClientSchema(schema, defineMutations);
```

Without added mutations, we can use `ClientOf<typeof schema>`. For a client with server data, pass the original client type as the third parameter: `ClientOf<typeof schema, ReturnType<typeof defineMutations>, BaseClient>`. The resulting type includes its server roots, mutations, and hydration scope alongside the client schema.

## Client Queries

The counter above always refers to the same object. Let's say we are building a task list and want to look up a task by ID instead. We can define a root with `clientQuery.byId`:

```ts
import { clientQuery } from 'react-fate';

const task = clientQuery.byId('Task');
```

Add `task` to the schema's `roots`, alongside any fixed roots. Now a component can request an individual task and read its view:

```tsx
const { task } = useRequest({ task: { args: { id: taskId }, view: TaskView } });
const data = useView(TaskView, task);
```

The root accepts a string or finite number as its `id`. If the task doesn't exist, the request also returns `null`. Creating or deleting a matching task updates the request automatically.

We can still use `clientQuery` to define our own arguments and resolver. For example, to accept only string IDs:

```ts
import { z } from 'zod';

const task = clientQuery('Task', {
  args: z.object({ id: z.string() }),
  resolve: ({ args }) => args.id,
});
```

The resolver returns a task ID or `null`.

For a lookup by another field, such as a slug, the resolver can use `read(view, type, id)` to read a view of a client object. fate tracks the selected fields and reruns the lookup when they change. Query resolvers are synchronous. The view requested by the component can also include relationships to server objects, which fate loads when needed.

## Extending Server Data

Client state can also extend data from your server. Let's say we want to bookmark posts in our blog without adding a field to the database. We can add `bookmarked` to the existing `Post` type with `typeExtensions`:

```ts
import { clientSchema, dataView, type EntityOf } from 'react-fate';
import { createFateClient } from 'react-fate/client';
import { z } from 'zod';

const postState = dataView<{ bookmarked: boolean }>('Post')({
  bookmarked: true,
});

const schema = clientSchema({
  typeExtensions: {
    Post: { defaults: () => ({ bookmarked: false }), view: postState },
  },
});

const fate = createFateClient(options).registerClientSchema(schema, ({ mutation }) => ({
  'post.bookmark': mutation('Post', {
    input: z.object({ id: z.string() }),
    resolve: ({ input, store }) =>
      store.update('Post', input.id, {
        bookmarked: !store.get('Post', input.id)?.bookmarked,
      }),
  }),
}));

export type Post = EntityOf<typeof fate, 'Post'>;
```

The `Post` type now includes both the server fields and `bookmarked`. We can select `title` and `bookmarked` in the same view, and call `fate.mutations.post.bookmark({ input: { id: post.id } })` to toggle the bookmark. All components reading that post's bookmark update together. Register the extended client with `ClientRegistration` as in [Client Setup](#client-setup).

When a post first enters the cache, fate supplies the missing client fields from `defaults`. Refetching the post or receiving a live update preserves its bookmark. fate only requests server fields from the backend.

Choose field names that do not already exist on the server. The `input` parser can be any object with a `parse(unknown)` method, such as a Zod schema.

With Zod, we can give an input field a default. For example, `z.object({ amount: z.number().default(1) })` lets us call the mutation with `{ input: {} }`. The resolver receives `input.amount` as a number. Transforms work the same way: the caller passes the original value, and the resolver receives the parsed result.

fate uses Standard Schema input types when the parser provides them. For a parser with only a `parse` method, callers use the same type as its parsed result.

## Computed Fields

Let's extend our counter with a field that shows twice its value. We can define this with `memo` and select the fields it depends on:

```ts
import { memo, dataView } from 'react-fate';

type CounterData = { id: string; value: number };
const counter = dataView<CounterData>('Counter')({
  doubled: memo({
    resolve: (_item: CounterData, { value }) => value * 2,
    select: { value: true },
  }),
  id: true,
  value: true,
});
```

A component can now select `doubled: true` in its view. fate reads `value` for the computation, calculates `doubled`, and makes the result available to the component. Incrementing the counter updates components that select `doubled` too, even if they don't select `value` themselves.

Computed fields run when they are read. fate reuses the result until a dependency or field argument changes, so we don't need to keep the derived value in sync ourselves or provide a default for it. Computed fields can also depend on other computed fields.

Just like a view, `select` uses `true` to select a field by name. Use `field('path')` to give a dependency a different name or read through a relationship. For example, `field('tasks.done')` returns an array of completion values when the task list is available.

The resolver receives the selected values in its second argument. Annotating the first argument with `CounterData` lets TypeScript infer that `value` is a number. The same inference works for relationship paths, arrays, and stored JSON objects. The result keeps its TypeScript type, including when we return a class instance.

Other components reading the same field share its result, so treat objects received by or returned from the resolver as read-only. To read a field from a related object, select its path, such as `field('author.name')`. Selecting the whole `author` relationship as a dependency is not supported.

### Field Arguments

Let's say our blog supports multiple languages and we want to display a post's title in English. We can pass arguments to the dependency just like we do in a view:

```ts
localizedTitle: memo({
  resolve: (_post: PostData, { title }) => title.toUpperCase(),
  select: { title: { args: { locale: 'en' } } },
}),
```

Now `localizedTitle` reads the English title, even if another component requests `title` in a different language. Without `args`, the dependency reads the title with its default arguments.

We can also let the component choose the language by passing the computed field's arguments through to `title`:

```ts
localizedTitle: memo({
  resolve: (_post: PostData, { title }) => title.toUpperCase(),
  select: { title: { args: ({ locale }) => ({ locale }) } },
}),
```

A component can now select `localizedTitle: { args: { locale: 'en' } }`. Components reading the same post with the same arguments share the result, including when they use different views. If a `network-only` request updates that title, components reading `localizedTitle` update too. The calculation runs when the field is read, so unused computed fields don't run just because data was fetched.

For a dependency with a different name or a relationship path, use `field('author.name', { args: { locale: 'en' } })`. These arguments apply to `name`. Argument functions must be pure. Selecting dependencies with arguments is currently supported in client schemas.

Client computations must be synchronous. Circular dependencies are rejected when the schema is registered. Server authorization, asynchronous resolvers, and filtered database counts are not supported in client computed fields.

## Relationships

Client objects can have relationships just like server objects. Use another data view for a single object and `list(childView)` for a list of related objects, and register each client type in `types`. A relationship can also point to a server object by ID. fate fetches any missing server fields selected by a view.

Inside a mutation, `store.create` creates a client object with its defaults, `store.update` changes its stored client fields, and `store.delete` removes it. For example, we can create a task and add it to a board in the same mutation:

```ts
store.create('Task', { id: taskId, title: 'Pack for the trip' });
store.append('Board', boardId, 'tasks', taskId);
```

`store.append` adds the task without requiring us to read and copy the board's task list. The task and its list membership commit together. Appends preserve additions from other mutations, and an ID already in the list keeps its position. The objects being appended must already exist or have been created earlier in the mutation.

To remove the task from the board, use `store.remove('Board', boardId, 'tasks', taskId)`. The task stays in the store, and the other tasks keep their order. We can pass several IDs; missing IDs and duplicates are ignored. Use `store.delete` to delete the task itself.

Later reads inside the mutation see the removal, and it commits together with the other changes. Like `append`, `remove` applies to the list when the mutation commits, preserving unrelated additions and removals from other mutations.

Use `store.has(type, id)` to check whether an object exists, or `store.get(type, id)` to read a copy of its stored fields. `store.get` includes changes made earlier in the mutation. It can return partial data or `undefined` for a missing object. It doesn't fetch missing fields or calculate computed values. Use views to read computed fields and remote mutations to change server fields.

For frequent updates to entities with large relationships, use
`store.get(type, id, fields)` to copy only the stored fields you need, and
`store.patch(type, id, patch)` to stage a write without constructing a return
snapshot. Both use the same mutation overlay and atomic commit as `get` and
`update`:

```ts
const board = store.get('Board', 'main', ['count']);
store.patch('Board', 'main', { count: (board?.count ?? 0) + 1 });
```

A projection returns only the requested fields. Selected relationships are still
detached copies; unselected relationships are not traversed. `patch` returns
`void` and validates stored client fields just like `update`. Existing `get` and
`update` calls continue to return detached snapshots of the complete stored graph.
Resolvers infer these methods automatically. Use `ClientMutationStore` for a
helper that needs them, or `ClientStore` for a helper that only needs the base
store methods.

Reads inside a mutation exclude optimistic updates. For example, an increment reads the confirmed count so it does not apply its own optimistic increment twice.

The resolver's return value becomes the action result. fate applies the changes made through the store and `mutateRemote`. Returning a copy of an object from earlier in the mutation won't overwrite later edits to that object.

## Combining Client and Server Updates

Now let's say we want to like a post on the server and bookmark it on the client with a single action. We can call the existing `post.like` server mutation through `mutateRemote`:

```ts
'post.likeAndBookmark': mutation('Post', {
  input: z.object({ id: z.string() }),
  resolve: async ({ input, mutateRemote, store }) => {
    store.update('Post', input.id, { bookmarked: true });
    const result = await mutateRemote('post.like', input);
    return { ...result, bookmarked: true };
  },
}),
```

The like and bookmark appear together after the mutation succeeds. If the resolver throws, fate discards its pending cache changes and follows the usual [mutation error handling](/guide/actions). We can use the same optimistic update, insertion, removal, and invalidation options as with other mutations.

This applies to the client cache. A failure cannot undo a server transaction that has already committed.

Calls to a remote mutation for the same entity inherit the action's selection and field arguments. Calls for a different entity do not. Pass a third argument to select the remote response explicitly, for example `mutateRemote('post.like', input, { select: { likes: true } })`. This argument also accepts `view` and `args`, just like a mutation invocation.

## State Lifetime

Each fate client has its own state. Client roots and the objects they reference stay in memory for that client's lifetime. Other objects, including client fields on server data, follow the usual [cache lifetime rules](/guide/requests#cache-lifetime).

For SSR, create a separate client for each request. `dehydrate()` and `hydrate()` include client data. Hydration replaces untouched defaults while preserving later client edits under the default merge policy. See [SSR and Hydration](/guide/requests#ssr-and-hydration).

fate checks schema metadata when restoring a hydration snapshot. Change `hydrationScope` for incompatible changes that aren't reflected in that metadata. For saved client data, use [migrations](#migrations) to carry existing values forward when the schema changes.

## Persisting Client State

Our counter resets when we reload the page. To keep its value, we can save client state in IndexedDB. Install the adapter with `vp add @nkzw/fate-indexeddb`, then add persistence when creating the client:

```ts
import { createIndexedDBStorage } from '@nkzw/fate-indexeddb';
import { createPersistence } from '@nkzw/fate/persistence';
import { createClient } from 'react-fate';

const fate = createClient({
  persistence: createPersistence({
    key: 'my-app',
    storage: createIndexedDBStorage(),
  }),
}).registerClientSchema(schema, defineMutations);
```

Use a stable `key` for each app or account. When we open the app again, fate restores the counter before its views render. The same setup also saves client fields on server objects, such as our post bookmarks.

Saved client state survives remote cache expiration and `clearCache()`. Adding fields with defaults preserves existing values. For other changes to saved data, we can define a [migration](#migrations). Server fields still follow the ordinary [read cache lifetime](/guide/persistence#cache-lifetime).

When a mutation changes client data, fate saves the changed objects and lists in a single transaction, including deletions. Views receive the confirmed state after the save succeeds. If saving fails, the mutation reports the error and keeps the previous confirmed state. We can still use optimistic updates to show a change while it is being saved.

Updating the counter writes the changed data rather than the entire saved graph. Tabs sharing the same persistence key coordinate their writes and check for newer saves before running a client mutation. Pass `persist: false` for a mutation whose changes should only stay in memory.

Set `clientState.maxBytes` to configure the saved graph's storage budget separately from the read cache. It defaults to the value of `maxBytes` (25 MiB by default). Use `clientState.limits` to adjust serialization limits per entry, such as `maxStringLength` for a long serialized document.

### Migrations

Let's say our app originally stored a task's text in a `label` field, and we want to rename it to `title`. We can keep existing tasks by incrementing `clientState.version` and adding a migration. Versions start at 1, so our first upgrade is version 2:

```ts
const persistence = createPersistence({
  clientState: {
    migrations: {
      2(state) {
        state.renameField('Task', 'label', 'title');
        state.mapRecords('Task', (record) => ({
          ...record,
          title: String(record.title).trim(),
        }));
      },
    },
    version: 2,
  },
  key: 'my-app',
  storage: createIndexedDBStorage(),
});
```

This migration renames `label` to `title` and removes whitespace around each title. `mapRecords` lets us change saved values or remove old fields while keeping each object's identity. `renameField` also handles saved list membership when renaming a relationship.

fate runs migrations in order before views read the saved data, then saves the complete upgrade in one transaction. Migration functions must be synchronous. Adding a field with a default doesn't require a migration.

If a migration fails, the previous saved version stays on disk. A tab running an older version reports an error if it tries to open or write data that has already been upgraded. New installations start at the configured version.

_If you tested a development build that saved client state under its hydration scope, fate imports data for the current scope on first open. If the schema has changed since then, set `clientState.legacyScope` to the previous client's `dehydrate().scope`. The import treats that data as version 1 and keeps the original copy. Close tabs running the earlier build before importing._

## Client-only Template

You can start with a complete client-only app using `create-fate`:

```sh
vp create fate -- --template client-only
```

The template includes React, Void Pages Routing, and a task list saved in IndexedDB. Add `--framework vue` for the Vue version. Try adding or completing a task, then reload the page to see the saved state.

Run `vp run build` to create static files in `dist/client/`. You can deploy them to a static host or directly to [Cloudflare](/integrations/cloudflare#client-only-apps).

From the fate repository, run `vp run dev:state` and open `http://localhost:6011` to try the React starter.

## Example

To try client state alongside server data, run `vp run dev` from the repository root. Click **Bookmark** on a post and watch other views of that post update. **Like & bookmark** also changes the server's like count. Refetch the post to see that its bookmark stays in place.
