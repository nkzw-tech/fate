# _fate_

**_fate_** is a modern data client for React inspired by [Relay](https://relay.dev/) and [GraphQL](https://graphql.org/). It combines view composition, normalized caching, data masking, Async React features, and type-safe data fetching.

## Existing GraphQL Template

Use this template when you want to use _fate_ with an existing GraphQL server.

```bash
vp create fate my-app --template graphql-client
```

## Connect Your Server

Set the GraphQL endpoint in `.env`:

```bash
VITE_GRAPHQL_URL="https://api.example.com/graphql"
```

If your server supports GraphQL SSE, set the live endpoint too:

```bash
VITE_GRAPHQL_LIVE_URL="https://api.example.com/graphql/stream"
```

Then edit `src/fate/graphql.ts`. This file is the mapping layer between your GraphQL schema and _fate_:

- `dataView(...)` describes the fields React components are allowed to select.
- `Root` describes the root GraphQL fields _fate_ can request.
- `fateGraphQL.roots` maps _fate_ root names to GraphQL field names.
- `fateGraphQL.mutations` maps _fate_ mutation names to GraphQL mutation fields.

The sample assumes your GraphQL server exposes:

- `viewer`
- `posts(first:, after:)`
- `node(id:)` or `nodes(ids:)`
- Relay-style connections with `edges`, `cursor`, `node`, and `pageInfo`
- Entity objects with stable `id` and `__typename`

Replace the sample `User` and `Post` views with your own schema types.

## Development

Install dependencies:

```bash
vp install
```

Generate the _fate_ client:

```bash
vp run fate:generate
```

Start the app:

```bash
vp run dev
```

Common commands:

- `vp run dev` starts the client.
- `vp run fate:generate` refreshes _fate_ client support after changing `src/fate/graphql.ts`.
- `vp check --fix` formats, lints, and type-checks the project.
- `vp run test:all` verifies the project.

## Translations

The React app uses fbtee 4 with its native Oxc Vite plugin and CLI. Setup and builds generate the runtime translation files automatically.

- Wrap UI text in `<fbt desc="Translator context">Text</fbt>`; use `fbs('Text', 'Translator context')` from `fbtee` for string attributes such as placeholders.
- Run `vp run fbtee:collect` in the app root to extract strings, then `vp run fbtee:prepare` to update the editable German and Japanese files in `translations/`.
- Translate entries marked `"status": "new"`, remove that status when finished, and run `vp run fbtee:translate` (or `vp run fbtee:all`). Commit `translations/`; runtime files in `src/translations/` are generated and ignored.
- Add locales to `src/lib/AvailableLanguages.tsx` and the `fbtee:prepare` script. The language selector remembers the choice. Server rendering starts in English and restores the browser preference after hydration.
