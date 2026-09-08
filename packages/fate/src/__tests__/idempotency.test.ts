import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { createGraphQLTransport } from '../graphqlTransport.ts';
import { createHTTPTransport } from '../httpTransport.ts';
import {
  createMutationIdempotency,
  type IdempotencyStore,
  type MutationReceipt,
} from '../idempotency.ts';
import type { MutationIdentity } from '../persistence-types.ts';
import { FateRequestError } from '../protocol.ts';
import { createSourceRegistry } from '../server/executor.ts';
import { createFateServer } from '../server/http.ts';
import { createTRPCTransport } from '../transport.ts';

const databases: Array<DatabaseSync> = [];
afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
});
const setup = (enabled = true) => {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec(
    'CREATE TABLE counter (value INTEGER); INSERT INTO counter VALUES (0); CREATE TABLE receipts (scope TEXT, id TEXT, value TEXT, PRIMARY KEY(scope, id))',
  );
  type Context = { db: DatabaseSync; scope: string };
  let tail: Promise<unknown> = Promise.resolve();
  const store: IdempotencyStore<Context> = {
    transaction(context, scope, id, run) {
      // Serialize this connection. BEGIN IMMEDIATE also excludes other SQLite writers.
      const task = tail
        .catch(() => {})
        .then(async () => {
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
        });
      tail = task;
      return task;
    },
  };
  const resolve = vi.fn(({ ctx, input }: { ctx: Context; input: { fail?: boolean } }) => {
    ctx.db.exec('UPDATE counter SET value = value + 1');
    if (input.fail) {
      throw new FateRequestError('BAD_REQUEST', 'Rejected');
    }
    return { id: 'counter', value: ctx.db.prepare('SELECT value FROM counter').get()!.value };
  });
  const idempotency = createMutationIdempotency({ scope: (ctx: Context) => ctx.scope, store });
  const server = createFateServer({
    context: () => ({ db, scope: 'account:1' }),
    idempotency: enabled ? idempotency : undefined,
    mutations: { increment: { resolve, type: 'Counter' } },
    roots: {},
    sources: {
      getSource: () => {
        throw new Error('Unused');
      },
      registry: createSourceRegistry<Context>([]),
    },
  });
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    server.handleRequest(new Request(url, init)),
  );
  const transport = createHTTPTransport<{
    mutations: { increment: { input: { fail?: boolean }; output: { id: string; value: number } } };
  }>({ fetch, url: 'http://fate.test/' });
  return { db, fetch, resolve, transport };
};
const identity = { id: 'logical-mutation-1', scope: 'account:1' };

test('native protocol and database transaction deduplicate simultaneous and later deliveries', async () => {
  const { db, resolve, transport } = setup();
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      transport.mutateDurably!('increment', {}, new Set(['value']), identity),
    ),
  );
  expect(results).toEqual(Array.from({ length: 6 }, () => ({ id: 'counter', value: 1 })));
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(db.prepare('SELECT value FROM counter').get()!.value).toBe(1);
  await expect(
    transport.mutateDurably!('increment', {}, new Set(['value']), identity),
  ).resolves.toEqual({
    id: 'counter',
    value: 1,
  });
});

test('effect and receipt roll back together when the resolver rejects', async () => {
  const { db, transport } = setup();
  await expect(
    transport.mutateDurably!('increment', { fail: true }, new Set(['value']), identity),
  ).rejects.toThrow('Rejected');
  expect(db.prepare('SELECT value FROM counter').get()!.value).toBe(0);
  expect(db.prepare('SELECT COUNT(*) AS count FROM receipts').get()!.count).toBe(0);
});

test('identities cannot be reused with changed inputs or another authenticated account', async () => {
  const { resolve, transport } = setup();
  await transport.mutateDurably!('increment', {}, new Set(['value']), identity);
  await expect(
    transport.mutateDurably!('increment', { fail: false }, new Set(['value']), identity),
  ).rejects.toThrow(/different input/);
  await expect(
    transport.mutateDurably!('increment', {}, new Set(['value']), { ...identity, scope: 'other' }),
  ).rejects.toThrow(/authenticated/);
  expect(resolve).toHaveBeenCalledTimes(1);
});

test('server without idempotency rejects durable calls before effects; ordinary calls still work', async () => {
  const { resolve, transport } = setup(false);
  await expect(
    transport.mutateDurably!('increment', {}, new Set(['value']), identity),
  ).rejects.toThrow(/createFateServer.*idempotency/i);
  expect(resolve).not.toHaveBeenCalled();
  await expect(transport.mutate!('increment', {}, new Set(['value']))).resolves.toEqual({
    id: 'counter',
    value: 1,
  });
});

test('durable HTTP calls reject on a legacy server before its resolver can execute', async () => {
  const effect = vi.fn();
  const versions: Array<number> = [];
  const transport = createHTTPTransport<{
    mutations: { increment: { input: object; output: object } };
  }>({
    async fetch(_url, init) {
      const body = JSON.parse(String(init?.body));
      versions.push(body.version);
      if (body.version !== 1) {
        return Response.json({ error: 'Invalid Fate protocol request.' }, { status: 400 });
      }
      return Response.json({
        results: body.operations.map(({ id }: { id: string }) => {
          effect();
          return { data: {}, id, ok: true };
        }),
        version: 1,
      });
    },
    url: 'http://legacy.test/',
  });
  await expect(transport.mutateDurably!('increment', {}, new Set(), identity)).rejects.toThrow();
  expect(effect).not.toHaveBeenCalled();
  await transport.mutate!('increment', {}, new Set());
  expect(effect).toHaveBeenCalledTimes(1);
  expect(versions).toEqual([2, 1]);
});

test('durable identity metadata cannot be sent as an ignorable version 1 extension', async () => {
  const { fetch, resolve } = setup();
  const response = await fetch('http://fate.test/', {
    body: JSON.stringify({
      operations: [
        {
          id: '1',
          input: {},
          kind: 'mutation',
          mutation: identity,
          name: 'increment',
          select: ['value'],
        },
      ],
      version: 1,
    }),
    method: 'POST',
  });
  expect(response.status).toBe(400);
  expect(resolve).not.toHaveBeenCalled();
});

test.each(['trpc', 'graphql'])(
  '%s can route durable deliveries to an idempotent endpoint and safely retry lost responses',
  async (kind) => {
    const { resolve, transport: http } = setup();
    let drop = true;
    const mutateDurably = vi.fn(
      async (
        name: 'increment',
        input: { fail?: boolean },
        select: Set<string>,
        mutationIdentity: MutationIdentity,
      ) => {
        const result = await http.mutateDurably!(name, input, select, mutationIdentity);
        if (drop) {
          drop = false;
          throw new TypeError('Lost response after commit');
        }
        return result;
      },
    );
    const ordinary = vi.fn(async (_input: { fail?: boolean }) => ({ id: 'counter', value: 0 }));
    const graphQLFetch = vi.fn();
    const transport =
      kind === 'trpc'
        ? createTRPCTransport({
            byId: {},
            client: {} as any,
            mutateDurably,
            mutations: { increment: () => ordinary },
          })
        : createGraphQLTransport<{
            increment: { input: { fail?: boolean }; output: { id: string; value: number } };
          }>({
            fetch: graphQLFetch,
            mutateDurably,
            mutations: { increment: { entity: 'Counter', field: 'increment' } },
            types: [{ type: 'Counter' }],
            url: 'http://graphql.test/',
          });
    await expect(
      transport.mutateDurably!('increment', {}, new Set(['value']), identity),
    ).rejects.toThrow('Lost response');
    await expect(
      transport.mutateDurably!('increment', {}, new Set(['value']), identity),
    ).resolves.toEqual({ id: 'counter', value: 1 });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(mutateDurably.mock.calls.map((call) => call[3])).toEqual([identity, identity]);
    expect(ordinary).not.toHaveBeenCalled();
    expect(graphQLFetch).not.toHaveBeenCalled();
  },
);

test('receipt-only recovery never executes an absent mutation and replays an existing result', async () => {
  const { fetch, resolve, transport } = setup();
  const lookup = { ...identity, replayOnly: true as const };
  await expect(
    transport.mutateDurably!('increment', {}, new Set(['value']), lookup),
  ).rejects.toMatchObject({ status: 404 });
  expect(resolve).not.toHaveBeenCalled();
  const result = await transport.mutateDurably!('increment', {}, new Set(['value']), identity);
  await expect(
    transport.mutateDurably!('increment', {}, new Set(['value']), lookup),
  ).resolves.toEqual(result);
  await expect(
    transport.mutateDurably!('increment', { fail: true }, new Set(['value']), lookup),
  ).rejects.toMatchObject({ status: 400 });
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).version)).toEqual([
    2, 2, 2, 2,
  ]);
});

test.each([1, 3])(
  'receipt-only metadata rejects unsupported protocol version %s',
  async (version) => {
    const { fetch, resolve } = setup();
    const response = await fetch('http://fate.test/', {
      body: JSON.stringify({
        operations: [
          {
            id: 'request',
            input: {},
            kind: 'mutation',
            mutation: { ...identity, replayOnly: true },
            name: 'increment',
            select: ['value'],
          },
        ],
        version,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(response.status).toBe(400);
    expect(resolve).not.toHaveBeenCalled();
  },
);
