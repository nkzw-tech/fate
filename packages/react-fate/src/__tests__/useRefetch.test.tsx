/**
 * @vitest-environment happy-dom
 */
import { clientRoot, createClient, view, type ViewRef } from '@nkzw/fate';
import { act, Component, type ReactNode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { FateClient, useRefetch, useRequest, useView } from '../index.tsx';

// @ts-expect-error React test environment.
global.IS_REACT_ACT_ENVIRONMENT = true;

type User = { __typename: 'User'; id: string; name: string };
const UserView = view<User>()({ id: true, name: true });
function UserName({ user }: { user: ViewRef<'User'> }) {
  return <span>{useView(UserView, user).name}</span>;
}
const setup = () => {
  const fetchQuery = vi.fn(async (_root: string, _select: Iterable<string>, _args?: unknown) => ({
    id: '1',
    name: 'Ada',
  }));
  const client = createClient({
    roots: { viewer: clientRoot<User | null, 'User'>('User') },
    transport: { fetchById: vi.fn(async () => []), fetchQuery },
    types: [{ type: 'User' }],
  });
  return { client, fetchQuery };
};

test('does no work until called and keeps its identity across equivalent inline requests', async () => {
  const { client, fetchQuery } = setup();
  const container = document.createElement('div');
  const root = createRoot(container);
  let refetch!: () => Promise<unknown>;
  function Component({ maxAge, name }: { maxAge: number; name: string }) {
    const refresh = useRefetch(
      { viewer: { args: { name }, view: UserView } },
      { persist: { maxAge } },
    );
    expectTypeOf(refresh)
      .returns.resolves.toHaveProperty('viewer')
      .toEqualTypeOf<ViewRef<'User'> | null>();
    refetch = refresh;
    return <span>Ready</span>;
  }
  const render = (name: string, maxAge: number, provider = client) =>
    act(async () =>
      root.render(
        <FateClient client={provider}>
          <Component maxAge={maxAge} name={name} />
        </FateClient>,
      ),
    );
  await render('Ada', 1000);
  expect(container.textContent).toBe('Ready');
  expect(fetchQuery).not.toHaveBeenCalled();
  const first = refetch;
  await render('Ada', 1000);
  expect(refetch).toBe(first);
  await act(async () => {
    await refetch();
  });
  expect(fetchQuery).toHaveBeenLastCalledWith('viewer', expect.anything(), { name: 'Ada' });
  await render('Grace', 1000);
  expect(refetch).not.toBe(first);
  await act(async () => {
    await refetch();
  });
  expect(fetchQuery).toHaveBeenLastCalledWith('viewer', expect.anything(), { name: 'Grace' });
  const second = refetch;
  await render('Grace', 2000);
  expect(refetch).not.toBe(second);
  const third = refetch;
  const other = setup();
  await render('Grace', 2000, other.client);
  expect(refetch).not.toBe(third);
  await act(async () => {
    await refetch();
  });
  expect(other.fetchQuery).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});

test.each(['cache-first', 'network-only'] as const)(
  'refreshes a %s Suspense request without hiding content, rejects failures, and retries',
  async (mode) => {
    const { client, fetchQuery } = setup();
    const container = document.createElement('div');
    const root = createRoot(container);
    let refetch!: () => Promise<unknown>;
    function Component() {
      const request = { viewer: { view: UserView } };
      refetch = useRefetch(request);
      const { viewer } = useRequest(request, { mode });
      return viewer ? <UserName user={viewer} /> : <span>No viewer</span>;
    }
    const render = () =>
      act(async () =>
        root.render(
          <FateClient client={client}>
            <Suspense fallback={<span>Loading</span>}>
              <Component />
            </Suspense>
          </FateClient>,
        ),
      );
    await render();
    expect(container.textContent).toBe('Ada');
    expect(fetchQuery).toHaveBeenCalledTimes(1);
    const pending = Promise.withResolvers<{ id: string; name: string }>();
    fetchQuery.mockReturnValueOnce(pending.promise);
    let refresh!: Promise<unknown>;
    let duplicate!: Promise<unknown>;
    await act(async () => {
      refresh = refetch();
      duplicate = refetch();
    });
    expect(fetchQuery).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe('Ada');
    await act(async () => {
      pending.resolve({ id: '1', name: 'Grace' });
      await Promise.all([refresh, duplicate]);
    });
    expect(container.textContent).toBe('Grace');
    const error = new Error('Offline');
    fetchQuery.mockRejectedValueOnce(error);
    await act(async () => {
      await expect(refetch()).rejects.toBe(error);
    });
    await render();
    expect(container.textContent).toBe('Grace');
    fetchQuery.mockResolvedValueOnce(null as never);
    await act(async () => {
      expect(await refetch()).toEqual({ viewer: null });
    });
    expect(container.textContent).toBe('No viewer');
    await act(async () => root.unmount());
  },
);

class RequestErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error ? this.state.error.message : this.props.children;
  }
}

test.each(['cache-first', 'stale-while-revalidate'] as const)(
  'recovers an initially rejected %s request after explicit refetch and boundary reset',
  async (mode) => {
    const { client, fetchQuery } = setup();
    const error = new Error('Unavailable');
    fetchQuery.mockRejectedValueOnce(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = document.createElement('div');
    const root = createRoot(container);
    const request = { viewer: { view: UserView } };
    let refetch!: () => Promise<unknown>;
    function Content() {
      const { viewer } = useRequest(request, { mode });
      return viewer ? <UserName user={viewer} /> : null;
    }
    function Page({ attempt }: { attempt: number }) {
      refetch = useRefetch(request);
      return (
        <RequestErrorBoundary key={attempt}>
          <Suspense fallback="Loading">
            <Content />
          </Suspense>
        </RequestErrorBoundary>
      );
    }
    const render = (attempt: number) =>
      act(async () =>
        root.render(
          <FateClient client={client}>
            <Page attempt={attempt} />
          </FateClient>,
        ),
      );
    try {
      await render(0);
      expect(container.textContent).toBe('Unavailable');
      fetchQuery.mockRejectedValueOnce(error);
      await act(async () => {
        await expect(refetch()).rejects.toBe(error);
      });
      expect(container.textContent).toBe('Unavailable');
      await act(async () => {
        await refetch();
      });
      await render(1);
      expect(container.textContent).toBe('Ada');
      const calls = fetchQuery.mock.calls.length;
      await render(1);
      expect(fetchQuery).toHaveBeenCalledTimes(calls);
    } finally {
      await act(async () => root.unmount());
      consoleError.mockRestore();
    }
  },
);
