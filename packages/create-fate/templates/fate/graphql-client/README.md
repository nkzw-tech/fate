# _fate_

**_fate_** is a modern data client for the web inspired by [Relay](https://relay.dev/) and [GraphQL](https://graphql.org/). It combines view composition, normalized caching, data masking, Async React features, and type-safe data fetching.

## Existing GraphQL Template

Use this template when you want to use _fate_ with an existing GraphQL server.

```bash
vp create fate -- --template graphql-client
```

## Connect Your Server

`env.ts` declares the public endpoint variables. Its sample GraphQL URL is a placeholder; replace it with your server's URL. For local development, create a gitignored `.env` file to override the default:

```bash
VITE_GRAPHQL_URL="https://api.example.com/graphql"
```

If your server supports GraphQL SSE, set the live endpoint too:

```bash
VITE_GRAPHQL_LIVE_URL="https://api.example.com/graphql/stream"
```

The live endpoint is optional; omit it or leave it empty to disable live updates. Void validates both URLs and uses `.env` only for local development. Keep the variable schema in `env.ts` and local values in `.env`.

For production, supply your public endpoints in the build environment or change their defaults in `env.ts`:

```bash
VITE_GRAPHQL_URL="https://api.example.com/graphql" vp run build
```

These `VITE_*` values are embedded in the client bundle. Do not put credentials in them. Production builds do not read `.env`.

Replace `src/fate/schema.graphql` with the schema exported by your existing
GraphQL server, then edit `src/fate/graphql.ts` to map application names:

- `fateGraphQL.schema` supplies the SDL used during generation.
- `fateGraphQL.roots` exposes query fields and optionally maps different names
  through `field`. Entity and connection types are inferred from the schema.
- `fateGraphQL.mutations` maps application mutation names to schema fields.
- `fateGraphQL.scalars` optionally describes custom scalar wire types. Unmapped
  custom scalars are `unknown`.

The sample schema includes `viewer`, `posts(first:, after:)`, `postLike(input:)`,
`node(id:)`, and `nodes(ids:)`, with Relay-style connections. Replace it with your
server's actual contract, including nullability and arguments.

Run `vp run fate:generate` to generate `.fate/schema.generated.ts`. Client views
use `GraphQLEntities` from that file; there are no handwritten entity or mutation
input types to keep synchronized. The schema and generation imports are excluded
from the browser client.

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
- `vp run fate:generate` refreshes _fate_ client support after changing the schema or `src/fate/graphql.ts`.
- `vp check --fix` formats, lints, and type-checks the project.
- `vp run test:all` verifies the project.

## Translations

The React app uses fbtee 5 with its native Oxc Vite plugin and CLI. Setup and builds generate the runtime translation files automatically.

- Wrap UI text in `<fbt desc="Translator context">Text</fbt>`; use `fbs('Text', 'Translator context')` from `fbtee` for string attributes such as placeholders.
- Run `vp run fbtee:collect` in the app root to extract strings, then `vp run fbtee:prepare` to update the editable German and Japanese files in `translations/`.
- Translate entries marked `"status": "new"`, remove that status when finished, and run `vp run fbtee:translate` (or `vp run fbtee:all`). Commit `translations/`; runtime files in `src/translations/` are generated and ignored.
- Add locales to `src/lib/AvailableLanguages.tsx` and the `fbtee:prepare` script. The language selector remembers the choice. Server rendering starts in English and restores the browser preference after hydration.
