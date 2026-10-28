import {
  buildSchema,
  experimentalExecuteIncrementally,
  GraphQLDeferDirective,
  GraphQLSchema,
  parse,
  validate,
} from 'graphql';
import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { GraphQLRequestError } from '../graphql-error.ts';
import { createGraphQLTransport } from '../graphqlTransport.ts';
import { clientRoot } from '../root.ts';
import { view } from '../view.ts';

type User = { __typename: 'User'; id: string; name: string };
const Name = view<User>()({ id: true, name: true });
const paths = new Set(['id', 'name']);
const fixture = (streaming = true) => {
  const encoder = new TextEncoder();
  const started = Promise.withResolvers<RequestInit>();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    cancel,
    start(value) {
      controller = value;
      controller.enqueue(encoder.encode('--test\r\n'));
    },
  });
  const response = new Response(body, {
    headers: { 'content-type': 'multipart/mixed;boundary="test";incrementalSpec=v0.2' },
  });
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    started.resolve(init!);
    return response;
  });
  const transport = createGraphQLTransport({
    fetch,
    live: false,
    roots: { feed: { type: 'User' }, menu: { type: 'User' } },
    streaming,
    types: [{ type: 'User' }],
    url: '/graphql',
  });
  const send = (payload: Record<string, unknown>) =>
    controller.enqueue(
      encoder.encode(
        `Content-Type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n--test${payload.hasNext === false ? '--\r\n' : '\r\n'}`,
      ),
    );
  const initial = () =>
    send({
      data: {},
      hasNext: true,
      pending: [
        { id: 'menu', label: 'f1', path: [] },
        { id: 'feed', label: 'f2', path: [] },
      ],
    });
  const result = (id: string, alias: string, name: string, hasNext = true) =>
    send({
      completed: [{ id }],
      hasNext,
      incremental: [{ data: { [alias]: { __typename: 'User', id: `User-${id}`, name } }, id }],
    });
  return {
    cancel,
    close: () => controller.close(),
    fetch,
    initial,
    result,
    send,
    started,
    transport,
  };
};

test('one streamed HTTP batch resolves independent reads before its slowest operation', async () => {
  const f = fixture();
  const menu = f.transport.fetchQuery!('menu', paths);
  const feed = f.transport.fetchQuery!('feed', paths);
  let feedSettled = false;
  void feed
    .finally(() => {
      feedSettled = true;
    })
    .catch(() => {});
  const init = await f.started.promise;
  expect(new Headers(init.headers).get('accept')).toContain('incrementalSpec=v0.2');
  expect(String(init.body)).toContain('@defer');
  f.initial();
  f.result('menu', 'f1', '早い 🐈');
  await expect(menu).resolves.toMatchObject({ id: 'menu', name: '早い 🐈' });
  expect(feedSettled).toBe(false);
  f.result('feed', 'f2', 'Feed', false);
  await expect(feed).resolves.toMatchObject({ id: 'feed', name: 'Feed' });
  expect(f.fetch).toHaveBeenCalledTimes(1);
});

test('a late failure preserves a completed result and never normalizes failed partial data', async () => {
  const f = fixture();
  const client = createClient({
    roots: { feed: clientRoot<User, 'User'>('User'), menu: clientRoot<User, 'User'>('User') },
    transport: f.transport,
    types: [{ type: 'User' }],
  });
  const menu = client.request({ menu: { view: Name } });
  const feed = client.request({ feed: { view: Name } });
  const failed = expect(feed).rejects.toMatchObject({
    message: 'Feed unavailable',
    name: 'GraphQLRequestError',
  });
  await f.started.promise;
  f.initial();
  f.result('menu', 'f1', 'Menu');
  const data = await menu;
  f.send({
    completed: [{ id: 'feed' }],
    hasNext: false,
    incremental: [
      {
        data: { f2: { __typename: 'User', id: 'User-feed', name: 'Partial' } },
        errors: [{ message: 'Feed unavailable', path: ['f2', 'name'] }],
        id: 'feed',
      },
    ],
  });
  await failed;
  expect(data.menu).toBeDefined();
  expect(client.store.read('User:menu')).toMatchObject({ name: 'Menu' });
  expect(client.store.read('User:feed')).toBeUndefined();
});

test('a truncated stream rejects unfinished reads without undoing completed reads', async () => {
  const f = fixture();
  const menu = f.transport.fetchQuery!('menu', paths);
  const feed = f.transport.fetchQuery!('feed', paths);
  const failed = expect(feed).rejects.toBeInstanceOf(GraphQLRequestError);
  await f.started.promise;
  f.initial();
  f.result('menu', 'f1', 'Menu');
  await expect(menu).resolves.toMatchObject({ name: 'Menu' });
  f.close();
  await failed;
});

test('aborting the final unfinished read releases the wire after another read completed', async () => {
  const f = fixture();
  const abort = new AbortController();
  const menu = f.transport.fetchQuery!('menu', paths);
  const feed = f.transport.fetchQuery!('feed', paths, undefined, { signal: abort.signal });
  const failure = new Error('Canceled feed');
  const failed = expect(feed).rejects.toBe(failure);
  const init = await f.started.promise;
  f.initial();
  f.result('menu', 'f1', 'Menu');
  await menu;
  abort.abort(failure);
  await failed;
  expect(init.signal?.aborted).toBe(true);
  await vi.waitFor(() => expect(f.cancel).toHaveBeenCalledTimes(1));
});

test('streaming accepts a complete ordinary JSON response', async () => {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ data: { f1: { __typename: 'User', id: 'User-1', name: 'Menu' } } }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  const transport = createGraphQLTransport({
    fetch,
    live: false,
    roots: { menu: { type: 'User' } },
    streaming: true,
    types: [{ type: 'User' }],
    url: '/graphql',
  });
  await expect(transport.fetchQuery!('menu', paths)).resolves.toMatchObject({
    id: '1',
    name: 'Menu',
  });
});

test('generated streamed queries execute with GraphQL incremental delivery', async () => {
  const original = buildSchema(
    'type User { id: ID!, name: String! } type Query { menu: User, feed: User }',
  );
  const schema = new GraphQLSchema({
    ...original.toConfig(),
    directives: [...original.getDirectives(), GraphQLDeferDirective],
  });
  const held = Promise.withResolvers<unknown>();
  const encoder = new TextEncoder();
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    const document = parse(request.query);
    expect(validate(schema, document)).toEqual([]);
    const result = await experimentalExecuteIncrementally({
      document,
      rootValue: {
        feed: () => held.promise,
        menu: { id: 'User-1', name: 'Menu' },
      },
      schema,
    });
    if (!('initialResult' in result)) {
      throw new Error(JSON.stringify(result));
    }
    const { initialResult, subsequentResults } = result;
    async function* parts() {
      yield initialResult;
      yield* subsequentResults;
    }
    const iterator = parts();
    const body = new ReadableStream({
      async cancel() {
        held.resolve(null);
        await iterator.return(undefined);
      },
      async pull(controller) {
        const part = await iterator.next();
        if (part.done) {
          controller.enqueue(encoder.encode('--\r\n'));
          controller.close();
        } else {
          controller.enqueue(
            encoder.encode(
              `\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(part.value)}\r\n--native`,
            ),
          );
        }
      },
      start(controller) {
        controller.enqueue(encoder.encode('--native'));
      },
    });
    return new Response(body, {
      headers: { 'content-type': 'multipart/mixed;boundary=native;incrementalSpec=v0.2' },
    });
  });
  const transport = createGraphQLTransport({
    fetch,
    live: false,
    roots: { feed: { type: 'User' }, menu: { type: 'User' } },
    streaming: true,
    types: [{ type: 'User' }],
    url: '/graphql',
  });
  const menu = transport.fetchQuery!('menu', paths);
  const feed = transport.fetchQuery!('feed', paths);
  try {
    await expect(menu).resolves.toMatchObject({ name: 'Menu' });
  } finally {
    held.resolve({ id: 'User-2', name: 'Feed' });
  }
  await expect(feed).resolves.toMatchObject({ name: 'Feed' });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('aborting one streamed operation keeps its sibling alive', async () => {
  const f = fixture();
  const abort = new AbortController();
  const menu = f.transport.fetchQuery!('menu', paths, undefined, { signal: abort.signal });
  const feed = f.transport.fetchQuery!('feed', paths);
  const reason = new Error('Canceled menu');
  const failed = expect(menu).rejects.toBe(reason);
  const init = await f.started.promise;
  f.initial();
  abort.abort(reason);
  await failed;
  expect(init.signal?.aborted).toBe(false);
  f.result('feed', 'f2', 'Feed');
  await expect(feed).resolves.toMatchObject({ name: 'Feed' });
  await vi.waitFor(() => expect(f.cancel).toHaveBeenCalledTimes(1));
});

test('a client timeout after partial delivery releases the remaining stream', async () => {
  const f = fixture();
  const client = createClient({
    roots: { feed: clientRoot<User, 'User'>('User'), menu: clientRoot<User, 'User'>('User') },
    transport: f.transport,
    types: [{ type: 'User' }],
  });
  const menu = client.request({ menu: { view: Name } });
  const feed = client.request({ feed: { view: Name } }, { timeout: 20 });
  const failed = expect(feed).rejects.toMatchObject({ name: 'TimeoutError' });
  await f.started.promise;
  f.initial();
  f.result('menu', 'f1', 'Menu');
  await menu;
  await failed;
  await vi.waitFor(() => expect(f.cancel).toHaveBeenCalledTimes(1));
});

test.each([
  ['unknown completion', { completed: [{ id: 'unknown' }], hasNext: true }],
  ['missing result', { completed: [{ id: 'menu' }], hasNext: true }],
  ['premature completion', { hasNext: false }],
  ['duplicate identity', { hasNext: true, pending: [{ id: 'menu', label: 'f1', path: [] }] }],
  ['nested patch', { hasNext: true, incremental: [{ data: {}, id: 'menu', subPath: ['name'] }] }],
])('rejects %s rather than settling incomplete data', async (_name, frame) => {
  const f = fixture();
  const menu = f.transport.fetchQuery!('menu', paths);
  const feed = f.transport.fetchQuery!('feed', paths);
  const failed = Promise.all([
    expect(menu).rejects.toMatchObject({ kind: 'protocol', name: 'GraphQLRequestError' }),
    expect(feed).rejects.toMatchObject({ kind: 'protocol', name: 'GraphQLRequestError' }),
  ]);
  await f.started.promise;
  f.initial();
  f.send(frame);
  await failed;
});

test('streaming never applies incremental directives or negotiation to mutations', async () => {
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const query = JSON.parse(String(init?.body)).query;
    expect(query).toContain('mutation FateMutation');
    expect(query).not.toContain('@defer');
    expect(new Headers(init?.headers).get('accept')).toBeNull();
    return new Response(
      JSON.stringify({ data: { f1: { __typename: 'User', id: 'User-1', name: 'New' } } }),
    );
  });
  const transport = createGraphQLTransport<{ rename: { input: { name: string }; output: User } }>({
    fetch,
    live: false,
    mutations: { rename: { entity: 'User', field: 'rename', inputArg: false } },
    streaming: true,
    types: [{ type: 'User' }],
    url: '/graphql',
  });
  await expect(transport.mutate!('rename', { name: 'New' }, paths)).resolves.toMatchObject({
    id: '1',
    name: 'New',
  });
});
