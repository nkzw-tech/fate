import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { mutation } from '../mutation.ts';

test('custom identity optimistic updates use input identity fields', async () => {
  type Note = { __typename: 'Note'; slug: string; title: string };
  const mutations = { edit: mutation<Note, { slug: string; title: string }, Note>('Note') };
  const send = Promise.withResolvers<Note>();
  const mutate = vi.fn(async () => send.promise);
  const roots = {};
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    roots,
    transport: {
      fetchById: async () => [],
      // @ts-expect-error This mock returns a concrete Note for the generic method.
      mutate,
    },
    types: [
      { fields: { title: 'scalar' }, getId: (record) => (record as Note).slug, type: 'Note' },
    ],
  });
  client.write('Note', { slug: 'a', title: 'Original' }, new Set(['slug', 'title']));
  const result = client.mutations.edit({
    input: { slug: 'a', title: 'Confirmed' },
    optimistic: { title: 'Optimistic' },
  });
  void result.catch(() => {});
  expect(mutate).toHaveBeenCalledTimes(1);
  const pendingTitle = client.store.read('Note:a')?.title;
  const phantom = client.store.read('Note:undefined');
  send.resolve({ __typename: 'Note', slug: 'a', title: 'Confirmed' });
  await result;
  expect(phantom).toBeUndefined();
  expect(pendingTitle).toBe('Optimistic');
});
