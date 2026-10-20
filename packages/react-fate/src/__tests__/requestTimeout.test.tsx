/** @vitest-environment happy-dom */
import { clientValueRoot, createClient } from '@nkzw/fate';
import { act, Component, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { FateClient, useRefetch, useRequest, useRequestState } from '../index.tsx';

// @ts-expect-error React test environment.
global.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.useRealTimers());
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error?.name ?? this.props.children;
  }
}
const setup = () => {
  const pending = Promise.withResolvers<unknown>();
  const fetchQuery = vi.fn(() => pending.promise);
  const client = createClient({
    roots: { value: clientValueRoot<string>() },
    transport: { fetchById: vi.fn(), fetchQuery },
    types: [],
  });
  const request = { value: { value: true } } as const;
  const container = document.createElement('div');
  const root = createRoot(container, { onCaughtError: () => {} });
  return { client, container, fetchQuery, request, root };
};

test('a Suspense timeout survives rerenders and its boundary recovers after explicit retry', async () => {
  vi.useFakeTimers();
  const { client, container, fetchQuery, request, root } = setup();
  function Screen() {
    return useRequest(request, { timeout: 20 }).value;
  }
  const render = (key: string) =>
    act(async () =>
      root.render(
        <FateClient client={client}>
          <Boundary key={key}>
            <Suspense fallback="Loading">
              <Screen />
            </Suspense>
          </Boundary>
        </FateClient>,
      ),
    );
  await render('first');
  expect(container.textContent).toBe('Loading');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15);
  });
  await render('first');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5);
  });
  expect(container.textContent).toBe('TimeoutError');
  expect(fetchQuery).toHaveBeenCalledTimes(1);
  fetchQuery.mockResolvedValueOnce('Recovered');
  await act(async () => {
    await client.request(request, { mode: 'network-only', timeout: 100 });
  });
  await render('second');
  expect(container.textContent).toBe('Recovered');
  await act(async () => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
});

test('useRefetch forwards timeout and signal while refresh errors preserve rendered data', async () => {
  vi.useFakeTimers();
  const { client, container, fetchQuery, request, root } = setup();
  fetchQuery.mockResolvedValueOnce('Cached');
  await client.request(request);
  let refetch!: () => Promise<unknown>;
  const controller = new AbortController();
  function Screen({ timeout }: { timeout: number }) {
    refetch = useRefetch(request, { signal: controller.signal, timeout });
    return useRequest(request).value;
  }
  const render = (timeout: number) =>
    act(async () =>
      root.render(
        <FateClient client={client}>
          <Boundary>
            <Suspense fallback="Loading">
              <Screen timeout={timeout} />
            </Suspense>
          </Boundary>
        </FateClient>,
      ),
    );
  await render(10);
  const first = refetch;
  await render(10);
  expect(refetch).toBe(first);
  await render(20);
  expect(refetch).not.toBe(first);
  let result!: Promise<unknown>;
  await act(async () => {
    result = refetch().catch((error) => error);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
  expect(await result).toMatchObject({ name: 'TimeoutError' });
  expect(container.textContent).toBe('Cached');
  await act(async () => {
    result = refetch().catch((error) => error);
    controller.abort();
  });
  expect(await result).toMatchObject({ name: 'AbortError' });
  expect(container.textContent).toBe('Cached');
  await act(async () => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
});

test('useRequestState exposes timeouts as state without suspending', async () => {
  vi.useFakeTimers();
  const { client, container, request, root } = setup();
  function Screen() {
    const state = useRequestState(request, { timeout: 10 });
    return state.error instanceof Error ? state.error.name : state.status;
  }
  await act(async () =>
    root.render(
      <FateClient client={client}>
        <Screen />
      </FateClient>,
    ),
  );
  expect(container.textContent).toBe('pending');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(container.textContent).toBe('TimeoutError');
  await act(async () => root.unmount());
});
