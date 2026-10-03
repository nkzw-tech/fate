# Preact

_fate_ supports Preact through `preact-fate`. It exports the same API as `react-fate`: `view`, `useRequest`, `useRequestState`, `useView`, `useListView`, `useLiveView`, `useLiveListView`, `useFateClient`, and the `FateClient` provider. It is built on `preact` and `preact/hooks` and does not need `preact/compat`. `preact-fate` requires Preact 11.

## Installation

Install `preact-fate` in your Preact client:

::: code-group

```bash [npm]
npm add preact-fate
```

```bash [pnpm]
pnpm add preact-fate
```

```bash [yarn]
yarn add preact-fate
```

:::

If your server lives in a separate package, install `@nkzw/fate` there as a runtime dependency too.

## Vite Plugin

Use the Preact adapter's Vite plugin in the client app:

```ts
import { fate } from 'preact-fate/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    fate({
      module: '@your-org/server/fate.ts',
      transport: 'native',
    }),
  ],
});
```

The plugin generates `preact-fate/client`, which contains the typed `createFateClient` helper for your app. The `module` and `transport` options are the same as for the React adapter. Compile JSX with Preact's runtime, for example with `"jsxImportSource": "preact"` in your `tsconfig.json`.

## Providing the Client

Create a client with `createFateClient` and provide it with `FateClient`:

```tsx
import { FateClient, Suspense } from 'preact-fate';
import { createFateClient } from 'preact-fate/client';
import AppRoutes from './AppRoutes.tsx';

const fate = createFateClient({
  url: '/fate',
});

export default function App() {
  return (
    <FateClient client={fate}>
      <Suspense fallback={<p>Loading…</p>}>
        <AppRoutes />
      </Suspense>
    </FateClient>
  );
}
```

## Suspense

Preact only ships `Suspense` in `preact/compat`, so `preact-fate` re-exports `Suspense` and `lazy` from [`preact-suspense`](https://github.com/JoviDeCroock/preact-suspense). `useRequest`, `useView`, and the list and live hooks suspend like they do in React, with a few differences:

- They only suspend on their first render. When a request or ref changes later, the previous data stays on screen until the new data is ready, which is what `useDeferredValue` gives you in React.
- Every component that suspends needs a `Suspense` boundary above it. React lets the root suspend without one; Preact doesn't.
- A component that suspended renders itself again once its data is ready. That makes `preact-iso`'s `Router` and `ErrorBoundary` work as boundaries too. `Router` keeps the previous route on screen while the next one loads.

## Views, Requests, and Mutations

Everything else matches the React adapter, so the [Views](./views.md), [Requests](./requests.md), [List Views](./list-views.md), [Live Views](./live-views.md), and [Actions](./actions.md) guides apply as written. React-only APIs such as `useActionState`, `useOptimistic`, and `useTransition` don't exist in Preact. Call `fate.mutations` from event handlers instead; optimistic updates and rollbacks work the same way.

The repository includes a Preact port of the example app in `example/client-preact`. Run it with `vp run dev:preact`.
