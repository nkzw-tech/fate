<h1 style="font-weight: 500; color: var(--vp-post-headline);">
  What's new in <picture class="fate-logo">
    <source media="(prefers-color-scheme: dark)" srcset="/fate-logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="/fate-logo.svg">
    <img alt="fate" src="/fate-logo.svg" style="display: inline; height: 40px; vertical-align: middle;">
  </picture> 2.0?
  <div style="display: none">

# What's new in fate 2.0?

  </div>
</h1>

A year ago I set out to build _fate_, a modern data client for Async React. Since shipping 1.0 earlier this year, I realized fate's potential was bigger than its initial idea. Today I'm releasing _fate_ 2.0 with all of these features that were added since 1.0:

- _fate_ is now also a _great_ GraphQL client with support for streaming and deferred data loading.
- It supports Vue as a UI framework.
- You can now use _fate_ to manage client state. You can augment server types with client fields, build a client-only app without a backend, execute client-only mutations, and persist data using IndexedDB for storage.
- Reactive memo fields derive values from client and server data, share their results across views, and update automatically when their dependencies change.
- Offline mutations save changes on the device before sending them to the server when a connection is restored.
- SSR cache hydration allows clients to reuse data loaded on the server.
- New APIs let you pass parameters to views, make conditional selections, and fetch data based on the response type. Mutations now support explicit list insertion, removal and targeted invalidation.
- Deploy to Cloudflare through [Void](https://void.cloud) which is now the default for `vp create fate`.

In addition to the above, _fate_ reduced request processing time by roughly 35% and retained memory usage by 45%.

## _fate_ in Production

I've always been a fan of [owning your dependencies](https://cpojer.net/posts/principles-of-devx). Even though fate started out as a modern data client primarily for new apps, over time it evolved into a client for both GraphQL and local data, and has been deployed to production in [Athena Crisis](https://athenacrisis.com). In Athena Crisis, _fate_ replaced [Relay](https://relay.dev/) as a GraphQL client, and [TinyBase](https://tinybase.org/) for local data persistence. This migration resulted in less code, better performance, Async React support, and faster page transitions and user interactions.

Athena Crisis manages server data alongside local client data and offline data. With fate, all of these are managed through the same APIs: Data is requested using `useRequest`, selected with `useView` and updated through React Actions, regardless of whether it is local or remote. When offline, mutations are queued and retried using idempotency keys.

Another common use case is doing expensive client-side operations on server or local data. For example, an editor and its preview might both need to turn a serialized document into an object that is easier to work with. In React, developers commonly use `useMemo` to avoid repeating that work. However, each component instance calculates and caches its own result, so both components still perform the same operation on the same data. People commonly [use context](https://github.com/nkzw-tech/create-context-hook) to solve this, but it becomes cumbersome to manage in large apps with a lot of data.

Instead, _fate_ ships with a `memo` function for derived data. You define the dependencies and the operation on the data type itself, and views can read the derived field like any other remote or local data. Multiple views of the same object share the result. When its dependencies change, all views reading that field are automatically updated.

## Try fate 2.0

You can start a new app using Vite+:

```sh
vp create fate
```

or pnpm:

```sh
pnpm create fate
```

The CLI gives you options for the UI library, backend, [i18n via fbtee](https://github.com/nkzw-tech/fbtee/releases/tag/v6.0.0) and can set up a client-only app.

---

Let's dive into the details of everything that's new since 1.0:

## Async React

There are many discussions about whether frameworks still matter now that agents write all code. It's an easy take for getting views on Twitter/X, yet I haven't seen viable alternatives that work at scale. Here is how I look at it: Even with agents, the fundamental constraints and principles on the web have not changed: Apps still have to manage resources, fetch data, and provide a good user experience – good frameworks let us solve these problems once, and share the solutions with the broader ecosystem.

This is where [Void](https://void.cloud) for routing, automatic resource provisioning and deployment, _fate_ for data, and [Astryx](https://astryx.atmeta.com/) for UI come together to create the first full Async React stack that provides a fluid and interruptible user experience. For example, typing into a search field should stay responsive even when updating a large list of results is expensive. With Async React, we can give rendering those results a lower priority. Another keystroke can interrupt an unfinished render, and React starts rendering the results for the latest input. On a fast device, updates might appear immediately. On a slower device, the results can lag behind while typing stays responsive without the developer having to do extra work.

Libraries that integrate with Async React can handle this coordination so we don't have to wire up transitions and pending states again for every feature. In other words, this stack prevents agents from littering your codebase with `useEffect`s.

Read more about [Deploy with Void](https://blog.cloudflare.com/deploy-with-void/).

## Client State

You can now define client types or extend server types with client fields. For example, we can add bookmarks to posts without changing the backend:

```ts
const schema = clientSchema({
  typeExtensions: {
    Post: {
      defaults: () => ({ bookmarked: false }),
      view: dataView<{ bookmarked: boolean }>('Post')({
        bookmarked: true,
      }),
    },
  },
});
```

After registering the schema on the client, components can select `title` and `bookmarked` in the same view. Changing a bookmark updates every component that reads it, and refetching the post preserves the `bookmarked` state.

Client mutations use the same Actions and mutation APIs as server mutations. They can create, update, and delete client objects, or forward to a server mutation through `mutateRemote`.

You can also build an entirely client-only app without a backend. See [Client State](/guide/client-state).

## Memo Fields

Let's say both a project card and its detail page display how many tasks are completed. Instead of calculating that value in both components, we can define a memo field on the project itself:

```ts
type TaskData = { done: boolean; id: string; title: string };
type ProjectData = { id: string; tasks: Array<TaskData> };

const task = dataView<TaskData>('Task')({ done: true, id: true, title: true });
const project = dataView<ProjectData>('Project')({
  id: true,
  progress: memo({
    resolve: (_item: ProjectData, { done = [] }) =>
      `${done.filter(Boolean).length} of ${done.length} complete`,
    select: { done: field('tasks.done') },
  }),
  tasks: list(task),
});
```

Both components can now select the `progress` field and _fate_ calculates the field when a view reads it. Completing a task or changing the task list updates the displayed progress automatically because _fate_ tracks memoized data dependencies. We don't need to repeat the calculation in each component. See [Memo Fields](/guide/client-state#computed-fields).

## Persistence and Offline Mutations

With the IndexedDB adapter, _fate_ can save cached server data and client state across page reloads. If the user closes the app while a mutation is pending, its optimistic update is restored when they return. Let's say we want to close a post editor once the change is saved on the device, even while offline. In 2.0, we can wait for `locallyPersisted`:

```tsx
const pending = fate.mutations.post.edit({
  input: { id: post.id, title },
  optimistic: { title },
});

void reportResult(pending);
await pending.locallyPersisted;
closeEditor();
```

The editor closes after the mutation is saved locally. Awaiting `pending` still waits for the server response. `reportResult` is the app's handler for the eventual result, including returned errors. See [Waiting for Local Persistence](/guide/persistence#waiting-for-local-persistence).

Client mutations can also save related changes together. For example, adding a task to a project changes both the task and the project's list. Inside a client mutation, we can do both together:

```ts
store.create('Task', { done: false, id: taskId, title });
store.append('Project', projectId, 'tasks', taskId);
```

We don't need to read and copy the existing list, and appending preserves additions from other mutations. With persistence configured, both changes are saved before views receive the confirmed state. If saving fails, neither change is committed.

When the shape of saved client data changes, we can define a migration. For example, to rename a task's `label` field to `title`:

```ts
const persistence = createPersistence({
  clientState: {
    migrations: {
      2(state) {
        state.renameField('Task', 'label', 'title');
      },
    },
    version: 2,
  },
  key: 'my-app',
  storage: createIndexedDBStorage(),
});
```

_fate_ runs the migrations before views read the saved data and saves the upgrade in one transaction. See [Persistence](/guide/persistence) and [Client State Migrations](/guide/client-state#migrations).

## GraphQL

_fate_ initially supported native HTTP and tRPC. You can now use it with an existing GraphQL API too. The Vite plugin reads your schema and generates TypeScript types, while components describe their data through the same Views and Requests. Custom scalars, unions, interfaces, arrays, and Relay-style connections are supported, and live views can subscribe through GraphQL subscriptions.

For servers that support `@defer` and the `v0.2` incremental delivery protocol, you can enable streaming:

```tsx
const fate = createFateClient({
  streaming: true,
  url: '/graphql',
});
```

When several reads share an HTTP request, each can finish independently. A component under its own Suspense boundary can render while another read is still loading. See the [GraphQL integration](/integrations/graphql).

## Vue

_fate_ started with Async React, but views and normalized caching are useful outside of React too. `vue-fate` brings the same views, requests, mutations, and live updates to Vue through reactive resources and `<Suspense>`.

Pass `--framework vue` to `vp create fate` to use Vue. See the [Vue guide](/guide/vue).

## Deferred Data Loading

Let's say a post's comments take longer to load than its title. We can defer the comments and render them under their own Suspense boundary:

```tsx
const PostView = view<Post>()({
  comments: defer({
    args: { first: 10 },
    items: { node: CommentView },
  }),
  title: true,
});
```

Reading the post makes its title available. Reading the comments with `useListView` loads any missing data and suspends that part of the UI. This works with every transport. With GraphQL, deferred fields use follow-up reads, which can also take advantage of streaming. See [Deferred Views](/guide/deferred-views).

## Parameters, Conditional Selections, and Aliases

Views can now take parameters. For example, we might only want to request an email address when showing the current user's profile:

```tsx
const ProfileView = view<User>()(({ isViewer }: { isViewer: boolean }) => ({
  email: when(isViewer, true),
  name: true,
}));
```

Pass `ProfileView({ isViewer })` when requesting or composing the view. The parameters travel with the ref, so child components can read `ProfileView` without passing them again. When the condition is false, `email` is undefined and isn't fetched.

Aliases let us select a field or view more than once with different arguments. For example, a dashboard can request active and completed projects together:

```tsx
const DashboardView = view<User>()({
  active: alias('projects', { args: { completed: false }, items: { node: ProjectView } }),
  completed: alias('projects', { args: { completed: true }, items: { node: ProjectView } }),
});
```

Both lists keep their own filters and pagination, while objects shared with other views stay in sync. See [Parameters and Conditional Selections](/guide/views#parameters-and-conditional-selections) and [Aliases](/guide/requests#aliases).

## Views for Different Result Types

A search might return both posts and users. We can now compose a view for each result type with `viewFor`:

```tsx
const SearchResultView = view<Post | User>()({
  ...viewFor('Post', PostView),
  ...viewFor('User', UserView),
});
```

Posts receive the fields from `PostView`, and users receive the fields from `UserView`. Components can check `__typename` to decide which card to render. This works with GraphQL unions and interfaces, and with lists containing multiple types over native HTTP or tRPC, including pagination and live updates. See [Views on Unions and Interfaces](/integrations/graphql#views-on-unions-and-interfaces).

## Actions and Mutations

Mutations now give us explicit control over which lists change. For example, archiving a post can remove it from the inbox and insert it into the archive:

```tsx
await fate.mutations.post.archive({
  input: { id: postRef.id },
  optimistic: { archived: true },
  remove: { from: inbox, node: postRef },
  insert: { into: archivedPosts, position: 'before' },
});
```

The post moves immediately, and a failed mutation rolls back the changes. We can also pass lists or view refs to `invalidate` when the next request should fetch fresh data, or compose result selections with an Action's `.with()` method. See [Actions](/guide/actions).

## SSR Cache Hydration

Data loaded on the server can now be passed to the browser with `dehydrate()` and restored with `hydrate()`. Components can read that data from the cache without fetching it again on the initial render. See [SSR and Hydration](/guide/requests#ssr-and-hydration).

## Reading and Refreshing Data

`useViews` reads an array of view refs in one call, which is useful when a component needs to sort or filter selected data. `useRefetch` refreshes a request while keeping the existing data visible, and requests can be cancelled or given a timeout.

React's `useRequest` also supports `cache-only` reads. For example, a document editor can refresh the viewer's data while online and keep reading saved data when offline:

```tsx
const request = useRequest(
  { viewer: { view: ViewerView } },
  { mode: isOnline ? 'stale-while-revalidate' : 'cache-only' },
);
const viewer = useView(ViewerView, request?.viewer);
```

See [Views](/guide/views#resolving-multiple-refs-with-useviews) and [Requests](/guide/requests).

## Performance and Reliability

We've also improved how _fate_ processes responses. GraphQL responses are written directly into the normalized cache, unchanged data reuses existing view snapshots, and completed requests release memory they no longer need. In the apps measured since 1.0, these changes reduced request processing time by roughly 35% and retained memory by 45%. We also fixed many edge cases around concurrent mutations, stale responses, pagination, live updates, authorization, and error recovery.

## Make your own _fate_

I spent the past several years across [Nakazawa Tech](https://nakazawa.tech), [VoidZero](https://voidzero.dev) and [Cloudflare](https://cloudflare.com) on making app development easier. The stack presented in [Building Scalable Applications](https://www.youtube.com/watch?v=rxPTEko8J7c) over a year ago was the right direction, but the wrong implementation for agents. Now we have [Vite+](https://viteplus.dev), Void, _fate_, and Astryx and there is no easier way to build a great app than telling an agent to use `vp create fate` and then `void deploy` it to Cloudflare. I go over this journey in my interview with [TECH WORLD](https://www.youtube.com/watch?v=P30_ec_t0Y8).

Please test your _fate_ and share your feedback to make it even better!
