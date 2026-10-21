/** @vitest-environment happy-dom */

import { createClient, view, type ViewRef } from '@nkzw/fate';
import { act, Component, startTransition, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';
import { FateClient, useView, useViews } from '../index.tsx';

// @ts-expect-error React test environment.
global.IS_REACT_ACT_ENVIRONMENT = true;

type User = { __typename: 'User'; id: string; name: string };
const Name = view<User>()({ id: true, name: true });
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error ? this.state.error.message : this.props.children;
  }
}

test.each(['single', 'plural'] as const)(
  'cancelled %s reader errors do not poison future cached reads',
  async (kind) => {
    const pending = Promise.withResolvers<Array<{ id: string; name: string }>>();
    const fetchById = vi.fn(() => pending.promise);
    const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'User' }] });
    const paths = new Set(['id', 'name']);
    client.write('User', { id: 'A', name: 'A' }, paths);
    const a = client.ref('User', 'A', Name);
    const b = client.ref('User', 'B', Name);
    function Single({ user }: { user: ViewRef<'User'> }) {
      return useView(Name, user).name;
    }
    function Plural({ user }: { user: ViewRef<'User'> }) {
      return useViews(Name, [user])[0].name;
    }
    const container = document.createElement('div');
    const root = createRoot(container, { onCaughtError: vi.fn() });
    const render = (user: ViewRef<'User'>) =>
      root.render(
        <Boundary>
          <FateClient client={client}>
            <Suspense fallback="Loading">
              {kind === 'single' ? <Single user={user} /> : <Plural user={user} />}
            </Suspense>
          </FateClient>
        </Boundary>,
      );
    try {
      await act(async () => render(a));
      await act(async () => startTransition(() => render(b)));
      expect(fetchById).toHaveBeenCalledTimes(1);
      expect(container.textContent).toBe('A');
      await act(async () => render(a));
      await act(async () => pending.reject(new Error('Abandoned request failed')));
      expect(container.textContent).toBe('A');
      await act(async () => client.write('User', { id: 'B', name: 'Recovered' }, paths));
      await act(async () => render(b));
      expect(container.textContent).toBe('Recovered');
      expect(fetchById).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
    }
  },
);
