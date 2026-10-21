# Getting Started

Create a new fate app from a template, or install it in an existing React or Vue project. For an overview of the ideas behind fate, read [Why fate?](/guide/why-fate).

## Template

Create a new fate app with Vite+:

```bash
vp create fate
```

Explore the [fate stack](https://fate.technology/#stack) to see the tools included in your new project.

Choose a backend in the template selector: Void, tRPC with Drizzle or Prisma, GraphQL with Prisma, or a client for an existing GraphQL server. React is the default; choose Vue in the selector or pass `--framework vue`.

## Manual Installation

For a React client, install `react-fate`. It requires React 19.2+:

::: code-group

```bash [npm]
npm add react-fate
```

```bash [pnpm]
pnpm add react-fate
```

```bash [yarn]
yarn add react-fate
```

:::

For a Vue client, install `vue-fate`:

::: code-group

```bash [npm]
npm add vue-fate
```

```bash [pnpm]
pnpm add vue-fate
```

```bash [yarn]
yarn add vue-fate
```

:::

If your server is a separate package, install `@nkzw/fate` there as a runtime dependency too. Install `@nkzw/fate` on the client only for a barebones integration without a framework adapter:

::: code-group

```bash [npm]
npm add @nkzw/fate
```

```bash [pnpm]
pnpm add @nkzw/fate
```

```bash [yarn]
yarn add @nkzw/fate
```

:::
