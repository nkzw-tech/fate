import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { mutation } from '../mutation.ts';
import { FateRequestError } from '../protocol.ts';
import { toEntityId } from '../ref.ts';

type Note = { __typename: 'Note'; id: string; title: string };
const noteId = toEntityId('Note', '1');
const input = { id: '1', title: 'Confirmed' };
const setup = (send: () => Promise<Note>) => {
  const mutations = { edit: mutation<Note, typeof input, Note>('Note') };
  const roots = {};
  const mutate = vi.fn((_name: 'edit', _input: typeof input, _select: Set<string>) => send());
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    roots,
    transport: {
      fetchById: async () => [],
      // @ts-expect-error The mock returns a concrete Note; the transport method is generic.
      mutate,
    },
    types: [{ type: 'Note' }],
  });
  client.write('Note', { id: '1', title: 'Original' }, new Set(['id', 'title']));
  return { client, mutate };
};

test.each([undefined, false, true])(
  'without persistence, persist=%s preserves synchronous optimism and ordinary delivery',
  async (persist) => {
    const { promise, resolve } = Promise.withResolvers<Note>();
    const { client, mutate } = setup(() => promise);
    const result = client.mutations.edit({ input, optimistic: { title: 'Optimistic' }, persist });
    expect(client.store.read(noteId)?.title).toBe('Optimistic');
    expect(mutate.mock.calls).toEqual([['edit', input, new Set(['id', 'title'])]]);
    const confirmed: Note = { ...input, __typename: 'Note' };
    resolve(confirmed);
    await expect(result).resolves.toEqual({ error: undefined, result: confirmed });
    expect(client.store.read(noteId)?.title).toBe('Confirmed');
  },
);

test.each([
  [400, false],
  [401, true],
  [403, true],
  [408, false],
  [409, false],
  [429, false],
  [500, true],
] as const)(
  'ordinary status %s preserves error identity, routing, and rollback',
  async (status, rejects) => {
    const error = new FateRequestError('BAD_REQUEST', 'Rejected', { status });
    const { client } = setup(async () => {
      throw error;
    });
    const result = client.mutations.edit({ input, optimistic: { title: 'Optimistic' } });
    if (rejects) {
      await expect(result).rejects.toBe(error);
    } else {
      await expect(result).resolves.toEqual({ error, result: undefined });
    }
    expect(client.store.read(noteId)?.title).toBe('Original');
  },
);

test('ordinary non-Error failures retain their cause and roll back', async () => {
  const cause = { message: 'Transport failure' };
  const { client } = setup(async () => {
    throw cause;
  });
  await expect(
    client.mutations.edit({ input, optimistic: { title: 'Optimistic' } }),
  ).rejects.toMatchObject({
    cause,
    message: "fate: Mutation 'edit' failed.",
  });
  expect(client.store.read(noteId)?.title).toBe('Original');
});

test('local preparation failures reject instead of becoming call-site errors', async () => {
  const { client, mutate } = setup(async () => ({ ...input, __typename: 'Note' }));
  const error = new FateRequestError('BAD_REQUEST', 'Local optimistic write failed');
  vi.spyOn(client, 'write').mockImplementation(() => {
    throw error;
  });
  await expect(client.mutations.edit({ input, optimistic: { title: 'Optimistic' } })).rejects.toBe(
    error,
  );
  expect(mutate).not.toHaveBeenCalled();
  expect(client.store.hasOptimisticUpdates).toBe(false);
  expect(client.store.read(noteId)?.title).toBe('Original');
});

test('unknown mutation entities still fail when constructing the client', () => {
  expect(() =>
    createClient({
      mutations: { edit: mutation<Note, typeof input, Note>('Note') },
      roots: {},
      transport: { fetchById: async () => [] },
      types: [],
    }),
  ).toThrow("fate: Unknown entity type 'Note'.");
});

test('GC invoked by a confirmation subscriber waits for the ordinary mutation to settle', async () => {
  const { promise, resolve } = Promise.withResolvers<Note>();
  const { client } = setup(() => promise);
  const result = client.mutations.edit({ input, optimistic: { title: 'Optimistic' } });
  const observed: Array<unknown> = [];
  const unsubscribe = client.store.subscribe(noteId, () => {
    if (client.store.read(noteId)?.title === 'Confirmed') {
      client.gc();
      observed.push(client.store.read(noteId)?.title);
    }
  });
  resolve({ ...input, __typename: 'Note' });
  await result;
  unsubscribe();
  expect(observed).toEqual(['Confirmed']);
  expect(client.store.read(noteId)).toBeUndefined();
});
