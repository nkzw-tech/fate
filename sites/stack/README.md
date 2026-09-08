# fatestack

The Nakazawa Tech stack, from application libraries to tooling. Built with React,
TypeScript, Void's pages router, Tailwind CSS, and Vite+.

## Development

Requires Node.js 24+ and pnpm 11 (or Vite+). Run these commands from the repository
root:

```sh
pnpm install
pnpm dev:stack
```

Open http://localhost:4006. Installation runs the site's `void prepare` script to
generate local Void configuration and types. The site shares the repository's
lockfile and Vite+ catalog.

```sh
pnpm test:stack
pnpm build:stack
```
