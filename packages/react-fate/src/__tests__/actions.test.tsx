/**
 * @vitest-environment happy-dom
 */
import { createClient, GraphQLRequestError, mutation, view } from '@nkzw/fate';
import { act, startTransition, useActionState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, expectTypeOf, test, vi } from 'vite-plus/test';

// @ts-expect-error React test environment.
global.IS_REACT_ACT_ENVIRONMENT = true;

test('bound actions expose selected results, pending state, expected errors, retry, and reset', async () => {
  type Note = { __typename: 'Note'; body: string; id: string; title: string };
  const NoteView = view<Note>()({ title: true });
  const pending = Promise.withResolvers<Note>();
  const mutate = vi.fn().mockReturnValueOnce(pending.promise);
  const mutations = { edit: mutation<Note, { id: string }, Note>('Note') };
  const roots = {};
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    roots,
    transport: { fetchById: async () => [], mutate },
    types: [{ type: 'Note' }],
  });
  const container = document.createElement('div');
  const root = createRoot(container);
  let dispatch!: (input: { input: { id: string } } | 'reset') => void;
  function Component() {
    const [state, edit, pending] = useActionState(client.actions.edit.with(NoteView), null);
    dispatch = edit;
    if (state && !state.error) {
      expectTypeOf(state.result).toEqualTypeOf<{
        __typename: 'Note';
        id: string;
        title: string;
      }>();
      // @ts-expect-error Unselected fields must not leak into native action state.
      void state.result.body;
    }
    return pending ? 'Pending' : state?.error ? state.error.message : state?.result.title || 'Idle';
  }
  try {
    await act(async () => root.render(<Component />));
    expect(container.textContent).toBe('Idle');
    await act(async () => startTransition(() => dispatch({ input: { id: '1' } })));
    expect(container.textContent).toBe('Pending');
    await act(async () =>
      pending.resolve({ __typename: 'Note', body: 'Unselected', id: '1', title: 'Saved' }),
    );
    expect(container.textContent).toBe('Saved');
    mutate.mockRejectedValueOnce(new GraphQLRequestError([{ message: 'invalid-title' }]));
    await act(async () => startTransition(() => dispatch({ input: { id: '1' } })));
    expect(container.textContent).toBe('invalid-title');
    mutate.mockResolvedValueOnce({ __typename: 'Note', id: '1', title: 'Retried' });
    await act(async () => startTransition(() => dispatch({ input: { id: '1' } })));
    expect(container.textContent).toBe('Retried');
    await act(async () => startTransition(() => dispatch('reset')));
    expect(container.textContent).toBe('Idle');
    expect(mutate).toHaveBeenCalledTimes(3);
  } finally {
    await act(async () => root.unmount());
  }
});
