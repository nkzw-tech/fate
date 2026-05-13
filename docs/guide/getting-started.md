# Getting Started

## Template

Create a new fate app with Vite+:

```bash
vp create fate my-app
```

The template selector can create a Void app with Drizzle, a tRPC app with Drizzle, or a tRPC app with Prisma. The template sources live in the fate repo under [`packages/create-fate/templates/fate`](https://github.com/nkzw-tech/fate/tree/main/packages/create-fate/templates/fate). They feature modern tools to deliver an incredibly fast development experience.

## Manual Installation

**_fate_** requires React 19.2+. For a React client, install `react-fate`:

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

If your server is a separate package, install `@nkzw/fate` there as a runtime dependency too. Install `@nkzw/fate` on the client only for a barebones integration without React:

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

> [!WARNING]
>
> **_fate_** is currently in alpha and not production ready. If something doesn't work for you, please open a pull request.

If you'd like to try the example app in GitHub Codespaces, click the button below:

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new?repo=nkzw-tech/fate)
