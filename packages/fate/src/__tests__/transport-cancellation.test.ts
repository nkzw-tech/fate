import { expect, test, vi } from 'vite-plus/test';
import { createGraphQLTransport } from '../graphqlTransport.ts';
import { createHTTPTransport } from '../httpTransport.ts';
import type { Transport } from '../transport.ts';

const setup = (kind: 'graphql' | 'http') => {
  const response = Promise.withResolvers<Response>();
  const fetch = vi.fn((_url: string | URL | Request, _init?: RequestInit) => response.promise);
  const transport: Transport =
    kind === 'graphql'
      ? createGraphQLTransport({
          fetch,
          live: false,
          roots: { first: { type: 'String' }, second: { type: 'String' } },
          types: [],
          url: '/graphql',
        })
      : createHTTPTransport({ fetch, live: false, url: '/fate' });
  const complete = () =>
    response.resolve(
      new Response(
        JSON.stringify(
          kind === 'graphql'
            ? { data: { f1: 'one', f2: 'two' } }
            : {
                results: [
                  { data: 'one', id: '1', ok: true },
                  { data: 'two', id: '2', ok: true },
                ],
                version: 1,
              },
        ),
      ),
    );
  return { complete, fetch, transport };
};

for (const kind of ['graphql', 'http'] as const) {
  test(`${kind}: cancels a batch member without aborting its sibling`, async () => {
    const { complete, fetch, transport } = setup(kind);
    const firstController = new AbortController();
    const first = transport.fetchQuery!('first', [], undefined, {
      signal: firstController.signal,
    }).catch((error) => error);
    const second = transport.fetchQuery!('second', []);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const signal = fetch.mock.calls[0][1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    firstController.abort();
    expect(await first).toMatchObject({ name: 'AbortError' });
    expect(signal?.aborted).toBe(false);
    complete();
    await expect(second).resolves.toBe('two');
  });

  test(`${kind}: aborts the fetch only after every batch member cancels`, async () => {
    const { fetch, transport } = setup(kind);
    const a = new AbortController();
    const b = new AbortController();
    const first = transport.fetchQuery!('first', [], undefined, { signal: a.signal }).catch(
      (error) => error,
    );
    const second = transport.fetchQuery!('second', [], undefined, { signal: b.signal }).catch(
      (error) => error,
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const signal = fetch.mock.calls[0][1]?.signal;
    a.abort();
    expect(signal?.aborted).toBe(false);
    b.abort();
    expect(signal?.aborted).toBe(true);
    expect(await first).toMatchObject({ name: 'AbortError' });
    expect(await second).toMatchObject({ name: 'AbortError' });
  });

  test(`${kind}: skips operations aborted before the batch flush`, async () => {
    const { fetch, transport } = setup(kind);
    const controller = new AbortController();
    const result = transport.fetchQuery!('first', [], undefined, {
      signal: controller.signal,
    }).catch((error) => error);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetch).not.toHaveBeenCalled();
    expect(await result).toMatchObject({ name: 'AbortError' });
  });
}

test('HTTP read cancellation keeps a mutation in the same batch alive', async () => {
  const response = Promise.withResolvers<Response>();
  const fetch = vi.fn((_url: string | URL | Request, _init?: RequestInit) => response.promise);
  const transport = createHTTPTransport<{
    mutations: { save: { input: Record<string, never>; output: boolean } };
  }>({
    fetch,
    live: false,
    url: '/fate',
  });
  const controller = new AbortController();
  const read = transport.fetchQuery!('first', [], undefined, { signal: controller.signal }).catch(
    (error) => error,
  );
  const mutation = transport.mutate!('save', {}, new Set());
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  controller.abort();
  expect(await read).toMatchObject({ name: 'AbortError' });
  expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(false);
  response.resolve(
    new Response(JSON.stringify({ results: [{ data: true, id: '2', ok: true }], version: 1 })),
  );
  await expect(mutation).resolves.toBe(true);
});

test.each(['graphql', 'http'] as const)(
  '%s does not send a read cancelled while asynchronous headers resolve',
  async (kind) => {
    const headers = Promise.withResolvers<HeadersInit>();
    const fetch = vi.fn();
    const transport =
      kind === 'graphql'
        ? createGraphQLTransport({
            fetch,
            headers: () => headers.promise,
            live: false,
            roots: { first: { type: 'String' } },
            types: [],
            url: '/graphql',
          })
        : createHTTPTransport({ fetch, headers: () => headers.promise, live: false, url: '/fate' });
    const controller = new AbortController();
    const result = transport.fetchQuery!('first', [], undefined, {
      signal: controller.signal,
    }).catch((error) => error);
    await Promise.resolve();
    controller.abort();
    headers.resolve({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  },
);
