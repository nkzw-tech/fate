import { DatabaseSync } from 'node:sqlite';
import {
  createMutationIdempotency,
  type IdempotencyStore,
  type MutationReceipt,
} from '@nkzw/fate/persistence/server';
import {
  createFateServer,
  dataView,
  list,
  type SourceRegistry,
  type SourceDefinition,
} from '@nkzw/fate/server';
import { z } from 'zod';
import type { Note } from './model.ts';

type Context = { account: string; db: DatabaseSync };

const getNote = (ctx: Context, id: string) => {
  const note = ctx.db
    .prepare('SELECT id, title, likes FROM notes WHERE account = ? AND id = ?')
    .get(ctx.account, id);
  return note ? ({ ...note, __typename: 'Note' } as Note) : null;
};
export function createBackend(filename: string) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS notes (account TEXT, id TEXT, title TEXT, likes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (account, id));
    CREATE TABLE IF NOT EXISTS receipts (scope TEXT, id TEXT, value TEXT NOT NULL, PRIMARY KEY (scope, id));
  `);
  const store: IdempotencyStore<Context> = {
    async transaction(context, scope, id, run) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await run({
          context,
          async read() {
            const row = db
              .prepare('SELECT value FROM receipts WHERE scope = ? AND id = ?')
              .get(scope, id);
            return row ? (JSON.parse(String(row.value)) as MutationReceipt) : undefined;
          },
          async write(receipt) {
            db.prepare('INSERT INTO receipts VALUES (?, ?, ?)').run(
              scope,
              id,
              JSON.stringify(receipt),
            );
          },
        });
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const noteView = dataView<Note>('Note')({ id: true, likes: true, title: true });
  const source: SourceDefinition<Note> = { id: 'id', view: noteView };
  const registry: SourceRegistry<Context> = new Map([
    [
      source,
      {
        byIds: async ({ ctx, ids }) =>
          ids.map((id) => getNote(ctx, String(id))).filter((note) => note !== null),
      },
    ],
  ]);
  const server = createFateServer({
    context: ({ request }) => ({
      // This example uses an account selector. Production must derive this from
      // the authenticated session, never trust a client-supplied account header.
      account: request.headers.get('x-example-account') === 'bob' ? 'bob' : 'alice',
      db,
    }),
    idempotency: createMutationIdempotency({
      scope: (ctx: Context) => `notes:${ctx.account}`,
      store,
    }),
    lists: {
      notes: {
        resolve: ({ ctx }: { ctx: Context }) => ({
          items: ctx.db
            .prepare('SELECT id, title, likes FROM notes WHERE account = ? ORDER BY rowid')
            .all(ctx.account)
            .map((row) => ({
              cursor: String(row.id),
              node: { ...row, __typename: 'Note' } as Note,
            })),
          pagination: { hasNext: false, hasPrevious: false },
        }),
      },
    },
    mutations: {
      like: {
        input: z.object({ id: z.string() }),
        resolve: ({ ctx, input }: { ctx: Context; input: { id: string } }) => {
          ctx.db
            .prepare('UPDATE notes SET likes = likes + 1 WHERE account = ? AND id = ?')
            .run(ctx.account, input.id);
          return getNote(ctx, input.id);
        },
        type: 'Note',
      },
      remove: {
        input: z.object({ id: z.string() }),
        resolve: ({ ctx, input }: { ctx: Context; input: { id: string } }) => {
          ctx.db
            .prepare('DELETE FROM notes WHERE account = ? AND id = ?')
            .run(ctx.account, input.id);
          return null;
        },
        type: 'Note',
      },
      save: {
        input: z.object({ id: z.uuid(), title: z.string().trim().min(1).max(100) }),
        resolve: ({ ctx, input }: { ctx: Context; input: { id: string; title: string } }) => {
          ctx.db
            .prepare(
              'INSERT INTO notes (account, id, title) VALUES (?, ?, ?) ON CONFLICT (account, id) DO UPDATE SET title = excluded.title',
            )
            .run(ctx.account, input.id, input.title);
          return getNote(ctx, input.id)!;
        },
        type: 'Note',
      },
    },
    roots: { notes: list(noteView) },
    sources: {
      getSource: (target) => ('view' in target ? target : source) as SourceDefinition<any>,
      registry,
    },
  });
  // Serialize access to this connection, including reads and ordinary mutations.
  // Each client sends one durable mutation at a time. Split batches here so two
  // tabs cannot open concurrent transactions on the same SQLite connection.
  let tail: Promise<unknown> = Promise.resolve();
  return {
    close: () => db.close(),
    async handleRequest(request: Request) {
      const body = (await request.clone().json()) as {
        operations?: Array<unknown>;
        version?: number;
      };
      const task = tail
        .catch(() => {})
        .then(async () => {
          if (!Array.isArray(body.operations) || body.operations.length < 2) {
            return server.handleRequest(request);
          }
          const results = [];
          for (const operation of body.operations) {
            const response = await server.handleRequest(
              new Request(request, {
                body: JSON.stringify({ ...body, operations: [operation] }),
                method: 'POST',
              }),
            );
            const data = (await response.json()) as { results: Array<unknown> };
            results.push(...data.results);
          }
          return Response.json({ results, version: 1 });
        });
      tail = task;
      return task;
    },
  };
}
