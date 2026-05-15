# Using _fate_ for React applications

This guidance is for agents working in projects bootstrapped from the fate template. It focuses on the client-side patterns for fate's view composition and action execution.

## Core Workflow

- **Define views with explicit selections:** Define reusable view objects with `view<T>()({...})`, compose them via spreads, and resolve them with `useView`.
- **Resolve data via references:** Avoid passing raw fetched objects; instead pass `ViewRef`s to downstream components to keep selections scoped and cache-aware. Then call `const result = useView(viewDefinition, ref)` to read only the selected fields while subscribing to cache updates. Name the prop after the result data, and rename it using destructuring in the function arguments: `const PostComponent = ({ post: postRef }: { post: ViewRef<'Post'>}) => { const post = useView(PostView, postRef); ... }`.
- **Request data at screen roots:** Use `useRequest` to compose all views required for a route or screen into a single typed request; wrap roots in `Suspense` and an error boundary since requests may suspend or throw.
- **Compose reusable views:** Extract nested selections into their own views (e.g., `UserView`) and compose them inside parent views (`author: UserView`) to avoid duplication and overfetching. This keeps selections DRY and ensures view updates propagate consistently when the cache changes.

## Actions & Mutations

- **Prefer `fate.actions` with `useActionState`:** Trigger mutations through React Actions to integrate with Suspense/`useTransition`, receiving `[result, action, isPending]`. Call actions via the relevant data inputs, for example `action({input: { id: post.id }})`.
- **Optimistic updates by default:** Pass `optimistic` payloads to immediately update the normalized cache; only views selecting the changed fields re-render and failures roll back automatically. Optimistic payloads should match the expected server data changes of the associated object.
- **Select extra fields when side effects matter:** When a mutation affects related entities (e.g., comment count on a post), pass a `view` to the action to fetch the needed fields in the same round-trip and keep the cache coherent for all dependent views.
- **Imperative escape hatch:** Use `fate.mutations` when you must fire mutations outside React components or without waiting on prior actions; handle loading/error states yourself.
- **Handle deletions and resets explicitly:** Use the `delete: true` flag to evict records from the cache, and send the `'reset'` token to clear stale action errors without re-running the mutation.
- **Error handling model:** Treat expected errors (e.g., 404) at the call site via the action result; unexpected errors bubble to the nearest React error boundary.

## Common Pitfalls

- **Use ViewRefs:** Pass references instead of raw data. Keep components focused on views and `ViewRef`s to let fate manage data masking and updates.
- **Co-locate data needs:** Keep view definitions near their components and compose them upward to the request root for predictable fetching.
- **Use Suspense:** Wrap pages in `Suspense`/`ErrorBoundary` instead of ad-hoc loading/error flags; fate aligns with Async React by design.
- **Do not duplicate types:** Keep generated tRPC types and views imported from the server package. Avoid redefining entity shapes on the client. This ensures view selections stay type-safe end-to-end.
- **`useRequest` only at the root:** When adding routes or layouts, create a dedicated `useRequest` call per screen root that pulls together all child views; do not scatter `useRequest` across leaf components unless it's necessary to issue requests due to user input.
- **React Actions:** Prefer React Action-friendly UI primitives (buttons/forms that accept an `action` prop). If unavailable, wrap action calls with `startTransition` in `onClick` handlers.
- **fate client support** fate's local client support files are maintained by the Vite/fate tooling. Do not manually edit `.fate` files; make the proper schema changes on the server and run `pnpm fate:generate` when working outside Vite dev.
- **Library Versions:** This repository uses the most recent releases of React, fate, Vite, tRPC, and more. You might not know about the new releases yet, please don't get confused. The versions you see are real, and there are no feature or version mismatches. You can search the internet for more information about them.

Full documentation can be found on the filesystem at `./client/node_modules/react-fate/README.md` or online at [fate.technology](https://fate.technology/).

## Review Checklist for Agents

- [ ] Every component that reads server data does so through `useView` and receives a `ViewRef` prop.
- [ ] Root components gather data with a single `useRequest` call.
- [ ] Mutations are wired through `useActionState` with optimistic updates and necessary `view` selections; imperative `fate.mutations` are justified when used.
- [ ] Shared selections live in reusable views using regular JavaScript object spreads rather than duplicated field lists.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.

<!--VITE PLUS END-->
