# Getting Started

## Template

Get started with [a ready-made template](https://github.com/nkzw-tech/fate-template#readme) quickly:

::: code-group

```bash [npm]
npx giget@latest gh:nkzw-tech/fate-template
```

```bash [pnpm]
pnpx giget@latest gh:nkzw-tech/fate-template
```

```bash [yarn]
yarn dlx giget@latest gh:nkzw-tech/fate-template
```

:::

`fate-template` comes with a simple tRPC backend and a React frontend using **_fate_**. It features modern tools to deliver an incredibly fast development experience. Follow its [README.md](https://github.com/nkzw-tech/fate-template#fate-quick-start-template) to get started.

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
