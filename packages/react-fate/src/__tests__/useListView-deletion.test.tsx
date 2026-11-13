/** @vitest-environment happy-dom */

import { clientRoot, createClient, mutation, toEntityId, view, type ViewRef } from '@nkzw/fate';
import { act, StrictMode, Suspense, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';
import { FateClient, useListView, useRequest, useView } from '../index.tsx';

// @ts-expect-error React test environment.
global.IS_REACT_ACT_ENVIRONMENT = true;

type Todo = { __typename: 'Todo'; id: string; title: string };
const TodoView = view<Todo>()({ id: true, title: true });
const selection = { items: { node: TodoView } } as const;
const roots = { todos: clientRoot<Todo, 'Todo'>('Todo') };
const mutations = { deleteTodo: mutation<Todo, { id: string }, Partial<Todo>>('Todo') };
const request = { todos: { list: selection } };

function Item({ todo }: { todo: ViewRef<'Todo'> }) {
  return <li>{useView(TodoView, todo).title}</li>;
}

test.each([
  { afterDelete: '13', beforeDelete: '123', commit: true },
  { afterDelete: '', beforeDelete: '2', commit: false },
])(
  'removes a deleted row without suspending or fetching it (commit: $commit)',
  async ({ afterDelete, beforeDelete, commit }) => {
    const response = Promise.withResolvers<Partial<Todo>>();
    const fetchById = vi.fn(async () => []);
    const client = createClient<[typeof roots, typeof mutations]>({
      mutations,
      roots,
      transport: {
        fetchById,
        fetchList: async () => ({
          items: Array.from(beforeDelete, (id) => ({
            cursor: id,
            node: { __typename: 'Todo', id, title: id },
          })),
          pagination: { hasNext: false, hasPrevious: false },
        }),
        mutate: vi.fn().mockReturnValue(response.promise),
      },
      types: [{ fields: { title: 'scalar' }, type: 'Todo' }],
    });
    const fallbackCommitted = vi.fn();
    function Fallback() {
      useLayoutEffect(() => {
        fallbackCommitted();
      }, []);
      return null;
    }
    function List() {
      const { todos } = useRequest<typeof request, typeof roots>(request);
      const [items] = useListView(selection, todos);
      return (
        <ul>
          {items.map(({ node }) => (
            <Item key={node.id} todo={node} />
          ))}
        </ul>
      );
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    let deletion: Promise<unknown> | undefined;
    try {
      await act(async () =>
        root.render(
          <StrictMode>
            <FateClient client={client}>
              <Suspense fallback={<Fallback />}>
                <List />
              </Suspense>
            </FateClient>
          </StrictMode>,
        ),
      );
      expect(container.textContent).toBe(beforeDelete);
      expect(fetchById).not.toHaveBeenCalled();
      fallbackCommitted.mockClear();

      await act(async () => {
        deletion = client.mutations
          .deleteTodo({ delete: true, input: { id: '2' } })
          .catch(() => undefined);
      });
      expect(container.textContent).toBe(afterDelete);
      expect(client.store.read(toEntityId('Todo', '2'))).toBeUndefined();
      expect.soft(fallbackCommitted).not.toHaveBeenCalled();
      expect.soft(fetchById).not.toHaveBeenCalled();

      // Check that settling the mutation does not start a separate fetch or fallback.
      fallbackCommitted.mockClear();
      fetchById.mockClear();
      await act(async () => {
        if (commit) {
          response.resolve({ id: '2' });
        } else {
          response.reject(new Error('Cannot delete'));
        }
        await deletion;
      });
      expect(container.textContent).toBe(commit ? afterDelete : beforeDelete);
      expect(fallbackCommitted).not.toHaveBeenCalled();
      expect(fetchById).not.toHaveBeenCalled();
    } finally {
      response.resolve({ id: '2' });
      await act(async () => {
        await deletion;
        root.unmount();
      });
    }
  },
);
