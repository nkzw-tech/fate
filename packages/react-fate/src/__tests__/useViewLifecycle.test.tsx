/** @vitest-environment happy-dom */

import {
  createClient,
  defer,
  isDeferred,
  view,
  type ViewSelection,
  type ViewRef,
} from '@nkzw/fate';
import { act, Component, startTransition, StrictMode, Suspense, type ReactNode } from 'react';
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

test.each([
  ['single', false, false],
  ['single', false, true],
  ['single', true, false],
  ['single', true, true],
  ['plural', false, false],
  ['plural', false, true],
  ['plural', true, false],
  ['plural', true, true],
] as const)(
  'initial %s errors reach the boundary and recover after explicit retries (deferred: %s, StrictMode: %s)',
  async (kind, deferred, strict) => {
    type Parent = User & { friend: User };
    const pending = Promise.withResolvers<Array<Record<string, unknown>>>();
    const retry = Promise.withResolvers<Array<Record<string, unknown>>>();
    const fetchById = vi.fn(() => retry.promise).mockReturnValueOnce(pending.promise);
    const client = createClient({
      roots: {},
      transport: { fetchById },
      types: [{ fields: { friend: { type: 'User' } }, type: 'User' }],
    });
    const ParentView = view<Parent>()({ friend: defer(Name) });
    client.write('User', { id: 'A' }, new Set(['id']));
    const ref = deferred
      ? (
          await client.readView<Parent, ViewSelection<typeof ParentView>, typeof ParentView>(
            ParentView,
            client.ref('User', 'A', ParentView),
          )
        ).data.friend
      : client.ref('User', 'B', Name);
    function Single() {
      return useView(Name, ref)?.name;
    }
    function Plural() {
      return useViews(Name, [ref])[0].name;
    }
    const container = document.createElement('div');
    const root = createRoot(container, { onCaughtError: vi.fn() });
    const render = (attempt = 0) => {
      const content = (
        <Suspense fallback="Loading">
          <FateClient client={client}>
            <Boundary key={attempt}>{kind === 'single' ? <Single /> : <Plural />}</Boundary>
          </FateClient>
        </Suspense>
      );
      root.render(strict ? <StrictMode>{content}</StrictMode> : content);
    };
    const read = () => (isDeferred(ref) ? client.readDeferred(ref) : client.readView(Name, ref));
    try {
      await act(async () => render());
      expect(fetchById).toHaveBeenCalledTimes(1);
      await act(async () => pending.reject(new Error('Initial request failed')));
      expect(fetchById).toHaveBeenCalledTimes(1);
      expect(container.textContent).toBe('Initial request failed');
      // A failed intentional retry must not turn a boundary reset into another fetch.
      fetchById.mockRejectedValueOnce(new Error('Retry failed'));
      await act(async () => {
        await expect(read()).rejects.toThrow('Retry failed');
      });
      await act(async () => render(1));
      expect(fetchById).toHaveBeenCalledTimes(2);
      expect(container.textContent).toBe('Initial request failed');
      fetchById.mockResolvedValueOnce(
        deferred
          ? [{ friend: { __typename: 'User', id: 'B', name: 'Recovered' }, id: 'A' }]
          : [{ id: 'B', name: 'Recovered' }],
      );
      await act(async () => {
        await read();
      });
      await act(async () => render(2));
      expect(fetchById).toHaveBeenCalledTimes(3);
      expect(container.textContent).toBe('Recovered');
      await act(async () => client.write('User', { id: 'B', name: 'Updated' }, new Set(['name'])));
      expect(container.textContent).toBe('Updated');
    } finally {
      await act(async () => root.unmount());
    }
  },
);

test.each(['single', 'plural'] as const)(
  'unmounting a pending %s reader does not erase another initial reader’s error',
  async (kind) => {
    const pending = Promise.withResolvers<Array<{ id: string; name: string }>>();
    const retry = Promise.withResolvers<Array<{ id: string; name: string }>>();
    const fetchById = vi.fn(() => retry.promise).mockReturnValueOnce(pending.promise);
    const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'User' }] });
    client.write('User', { id: 'A', name: 'A' }, new Set(['id', 'name']));
    const a = client.ref('User', 'A', Name);
    const b = client.ref('User', 'B', Name);
    function Single({ user }: { user: ViewRef<'User'> }) {
      return useView(Name, user).name;
    }
    function Plural({ user }: { user: ViewRef<'User'> }) {
      return useViews(Name, [user])[0].name;
    }
    const read = (user: ViewRef<'User'>) =>
      kind === 'single' ? <Single user={user} /> : <Plural user={user} />;
    const container = document.createElement('div');
    const root = createRoot(container, { onCaughtError: vi.fn() });
    const render = (stage: number) =>
      root.render(
        <FateClient client={client}>
          <Boundary key="first">
            <Suspense fallback="Loading">{stage < 2 && read(stage === 0 ? a : b)}</Suspense>
          </Boundary>
          <Boundary key="second">
            <Suspense fallback="Loading">{stage > 0 && read(b)}</Suspense>
          </Boundary>
        </FateClient>,
      );
    try {
      await act(async () => render(0));
      await act(async () => render(1));
      expect(fetchById).toHaveBeenCalledTimes(1);
      await act(async () => render(2));
      await act(async () => pending.reject(new Error('Shared request failed')));
      expect(fetchById).toHaveBeenCalledTimes(1);
      expect(container.textContent).toBe('Shared request failed');
    } finally {
      await act(async () => root.unmount());
    }
  },
);
