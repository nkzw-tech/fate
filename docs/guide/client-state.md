# Client State

fate can manage shared application state, such as bookmarks, drafts, and selected items. You can add client fields to server data or build an app entirely with client state. Components read it through [Views](/guide/views) and update it through [Actions](/guide/actions), using the same APIs as server data.

## Client Setup

Use `clientSchema` to define your client types and their defaults. For example, a counter needs an ID and a value:

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

`types` declares the data fate manages on the client. `roots` makes a specific object available to `useRequest`. Here, `counter` refers to the `Counter` with ID `main`. The `defaults` function supplies missing stored values for each object.

Call `registerClientSchema` before making requests or writing data. It registers the schema and mutations on the client and returns the same instance with the updated types.

Register your client type once with `ClientRegistration` so hooks know which requests and mutations are available. Export entity types with `EntityOf` for use in your views. In a monorepo, keep each app's registration in its own TypeScript project.

A client-only app needs no transport, Vite plugin, or code generation. Pass the client to the `FateClient` provider:

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

The definition helpers are shared with `@nkzw/fate/server` and are also available from `@nkzw/fate` and `vue-fate`. Vue apps use the same definitions with their [Vue provider and hooks](/guide/vue).

## Reading and Updating State

Define a view and read it with `useView`, just as you would for server data:

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

Both panels read the same counter. Clicking either button updates both components. Components that select other fields do not re-render.

If your React app has a separate client for local data, pass it to `useView(View, ref, { client })` to read from that client while keeping the existing provider for server data.

Mutations with no input fields can be called without arguments. You can still pass options, such as `fate.mutations.counter.increment({ view: CounterView })`. Mutations that declare input fields require an `input` object, even when all of those fields are optional.

Synchronous client mutations update the data immediately, before their returned promise settles. You can also use `fate.actions.counter.increment` with React's `useActionState`. Dispatch it with `increment({})`, or pass options such as `increment({ view: CounterView })`; no `input` property is needed. See [Actions](/guide/actions).

## Extending Server Data

Use `typeExtensions` to add fields to an existing server type. For example, you can keep a local bookmark on each post:

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

`Post` now includes the server fields and `bookmarked`. Components can select both in the same view, and all views of the same post share its bookmark. Register the extended client with `ClientRegistration` as in [Client Setup](#client-setup).

fate initializes client fields when a post first enters the cache. Refetching or receiving a live update preserves its bookmark. Client fields are not requested from the server, and server responses cannot overwrite them.

Choose field names that do not already exist on the server. The `input` parser can be any object with a `parse(unknown)` method, such as a Zod schema.

## Computed Fields

Use `computed` to derive a value from other fields. For example, add `doubled` to the counter definition:

```ts
import { computed, dataView } from 'react-fate';

type CounterData = { id: string; value: number };
const counter = dataView<CounterData>('Counter')({
  doubled: computed({
    resolve: (_item: CounterData, { value }) => value * 2,
    select: { value: true },
  }),
  id: true,
  value: true,
});
```

A view can select `doubled` without selecting `value`. fate tracks the dependency, so incrementing the counter updates components that read `doubled` too. You only provide initial values for stored fields; computed fields are calculated when read.

Set a dependency to `true` to read a field by the same name. Use `field('path')` to give a dependency a different name or read through a relationship, such as `tasks.done`. Dependencies can also refer to other computed fields. The resolver receives dependency values in its second argument. Annotate the first argument with your data type and let TypeScript infer the dependency types from the selection. A path through a list, such as `field('tasks.done')`, gives you an array of the selected values when the list is available. fate reuses the result until a dependency or field argument changes.

Dependencies read fields with their default arguments. If a view selects `title` with `{ locale: 'ja' }` alongside a computation that depends on `title`, fate loads both values. The computation uses the default title.

Client computations must be synchronous. Circular dependencies are rejected when the schema is registered. Server authorization, asynchronous resolvers, and filtered database counts are not supported in client computed fields.

## Relationships

Use another data view for a relationship and `list(childView)` for an array of related objects. Register each client type in `types`. Relationships can also point to existing server objects by ID; fate fetches any missing server fields selected by a view.

Inside a mutation, use `store.create(type, { id, ...fields })` to create a client object with its defaults, `store.update(type, id, patch)` to change stored client fields, and `store.delete(type, id)` to remove a client object. Update the parent's relationship when adding or removing an item. Use remote mutations to change server fields.

For a list relationship, use `store.append(type, id, field, ...memberIds)` to add records without reading the list. The members must already exist or have been created earlier in the mutation. IDs already in the list keep their position. The new records and list membership commit together. Use `store.has(type, id)` to check whether a record exists without reading its fields.

```ts
store.create('Task', { id: taskId, title: 'Pack for the trip' });
store.append('Board', boardId, 'tasks', taskId);
```

`store.get(type, id)` returns a copy of the object's stored fields, including changes made earlier in the current mutation. It can return partial data or `undefined` if the object is missing. It does not fetch missing fields or calculate computed values; use views to read computed fields.

Reads inside a mutation exclude optimistic updates. For example, an increment reads the confirmed count so it does not apply its own optimistic increment twice.

The resolver's return value is the action result. Changes to the graph come from `store.create`, `store.update`, `store.delete`, and staged `remote` responses. Returning an earlier snapshot does not write it back over newer edits.

## Combining Client and Server Updates

A client mutation can call an existing server mutation with `mutateRemote`. To like a post and bookmark it in one action, add this mutation to the post example:

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

The like and bookmark appear together after the resolver succeeds. If it throws, fate discards the pending cache changes and uses the usual [mutation error handling](/guide/actions). Existing optimistic update, insertion, removal, and invalidation options still work.

This applies to the client cache. A failure cannot undo a server transaction that has already committed.

Calls to a remote mutation for the same entity inherit the action's selection and field arguments. Calls for a different entity do not. Pass a third argument to select the remote response explicitly, for example `mutateRemote('post.like', input, { select: { likes: true } })`. This argument also accepts `view` and `args`, just like a mutation invocation.

## State Lifetime

Local roots and the objects they reference stay in memory for the client instance's lifetime. Other objects, including client fields on server data, follow the usual [cache lifetime rules](/guide/requests#cache-lifetime). Each client has its own state.

For SSR, create a separate client for each request. `dehydrate()` and `hydrate()` include client data. Hydration replaces untouched defaults while preserving later client edits under the default merge policy. See [SSR and Hydration](/guide/requests#ssr-and-hydration).

fate checks schema metadata when restoring a snapshot. Change `hydrationScope` when making other incompatible changes to stored data.

## Persisting Client State

Pass IndexedDB persistence when creating the client to keep client data across reloads. Install the adapter with `vp add @nkzw/fate-indexeddb`.

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

Use a stable key for each app or account. fate restores client records and client fields on server records before serving views. They survive cache expiration, schema changes, and `clearCache()`. Server fields still follow the ordinary read cache lifetime.

Client mutations save changed records and lists in a single transaction, including deletions. fate publishes the confirmed state after the write commits. If the write fails, the mutation reports the error and you can retry from the last confirmed state. Use `persist: false` to keep a mutation's changes in memory. Client mutations share a lock across tabs and check for newer saves before running.

Set `clientState.maxBytes` to configure the saved graph's storage budget separately from the read cache. It defaults to the value of `maxBytes` (25 MiB by default). Use `clientState.limits` to adjust serialization limits per entry, such as `maxStringLength` for a long serialized document.

### Migrations

Adding a field with a default preserves existing data. When changing the shape of saved data, increment `clientState.version` and add a migration for that version. Versions start at 1.

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

Migrations run in order before views can read the saved data. Each step is synchronous, and fate commits the complete upgrade atomically. `renameField` also renames persisted list membership. `mapRecords` can transform saved values and remove old fields while preserving the record's identity.

If an upgrade fails, the previous saved version stays on disk. A tab running an older version reports an error when opening or writing a graph that has been upgraded. New installations start at the configured version.

If you used an earlier build with scope-keyed client persistence, fate imports the graph for the current scope on first open. If the schema has already changed, set `clientState.legacyScope` to the previous client's `dehydrate().scope` to import that graph. The import treats the old graph as version 1 and leaves the original copy intact. Close tabs running that earlier build before importing.

## Client-only Template

Start a React app with Void Pages Routing and IndexedDB persistence.

```sh
vp create fate -- --template client-only
```

Add `--framework vue` for the Vue version. Both templates include a task list that keeps edits across reloads. Run `vp run build` for static output in `dist/client/`, or see the [Cloudflare deployment instructions](/integrations/cloudflare#client-only-apps).

From the fate repository, run `vp run dev:state` and open `http://localhost:6011` to try the React starter.

## Example

Run `vp run dev` from the repository root to try the mixed client and server example. **Bookmark** toggles a client field shared across views of the post. **Like & bookmark** also updates the server's like count. Refetching the post preserves its bookmark.
