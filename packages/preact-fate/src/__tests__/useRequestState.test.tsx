/**
 * @vitest-environment happy-dom
 */
import { clientRoot, createClient, view } from '@nkzw/fate';
import { expect, test, vi } from 'vite-plus/test';
import { FateClient } from '../context.ts';
import { useRequestState } from '../useRequestState.ts';
import { act } from './preact.ts';
import { createRoot } from './preact.ts';

type User = { __typename: 'User'; id: string; name: string };
const UserView = view<User>()({ id: true, name: true });
const request = { viewer: { view: UserView } };
function Search({ enabled }: { enabled: boolean }) {
  const result = useRequestState({ viewer: { view: UserView } }, { enabled });
  return (
    <span>
      {result.status}:{result.data?.viewer?.id}
    </span>
  );
}

function Cached() {
  const result = useRequestState(request, { mode: 'cache-only' });
  return (
    <span>
      {result.status}:{result.data?.viewer === null ? 'null' : result.data?.viewer?.id}
    </span>
  );
}

const setup = () => {
  const fetchQuery = vi.fn(async () => ({ id: '1', name: 'Ada' }));
  const client = createClient({
    roots: { viewer: clientRoot<User | null, 'User'>('User') },
    transport: { fetchById: vi.fn(async () => []), fetchQuery },
    types: [{ type: 'User' }],
  });
  return { client, fetchQuery };
};

test('does not fetch disabled requests and starts when enabled with stable inline inputs', async () => {
  const { client, fetchQuery } = setup();
  const element = document.createElement('div');
  const root = createRoot(element);
  const render = (enabled: boolean) =>
    act(async () =>
      root.render(
        <FateClient client={client}>
          <Search enabled={enabled} />
        </FateClient>,
      ),
    );
  await render(false);
  expect(element.textContent).toBe('disabled:');
  expect(fetchQuery).not.toHaveBeenCalled();
  await render(true);
  expect(element.textContent).toBe('ready:1');
  await render(true);
  expect(fetchQuery).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});

test('observes a cache-only miss becoming a complete nullable result without fetching', async () => {
  const { client, fetchQuery } = setup();
  const element = document.createElement('div');
  const root = createRoot(element);
  await act(async () =>
    root.render(
      <FateClient client={client}>
        <Cached />
      </FateClient>,
    ),
  );
  expect(element.textContent).toBe('missing:');
  expect(fetchQuery).not.toHaveBeenCalled();
  await act(async () => {
    await client.request(request);
  });
  expect(element.textContent).toBe('ready:1');
  fetchQuery.mockResolvedValueOnce(null as never);
  await act(async () => {
    await client.request(request, { mode: 'network-only' });
  });
  expect(element.textContent).toBe('ready:null');
  expect(fetchQuery).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
});

test('does not expose an incomplete cache selection or fetch missing view fields', async () => {
  const { client } = setup();
  client.write('User', { id: '1' }, new Set(['id']));
  const observer = client.observeRequest(
    { viewer: { id: '1', view: UserView } },
    { mode: 'cache-only' },
  );
  const dispose = observer.subscribe(() => {});
  expect(observer.getSnapshot()).toMatchObject({ data: undefined, status: 'missing' });
  client.write('User', { id: '1', name: 'Ada' }, new Set(['id', 'name']));
  const result = observer.getSnapshot();
  expect(result.status).toBe('ready');
  client.deleteRecord('User', '1');
  await expect(
    Promise.resolve().then(() => client.readView(UserView, result.data!.viewer)),
  ).rejects.toThrow(/cache/i);
  dispose();
});

test('reports initial failures without suspending or losing the original error', async () => {
  const { client, fetchQuery } = setup();
  const error = new Error('Offline');
  fetchQuery.mockRejectedValueOnce(error);
  const observer = client.observeRequest(request);
  const unsubscribe = observer.subscribe(() => {});
  await vi.waitFor(() =>
    expect(observer.getSnapshot()).toMatchObject({ error, isFetching: false, status: 'error' }),
  );
  unsubscribe();
});

test('notifies cache-only observers about optimistic deletion and rollback', async () => {
  const { client } = setup();
  await client.request(request);
  const observer = client.observeRequest(
    { viewer: { id: '1', view: UserView } },
    { mode: 'cache-only' },
  );
  const listener = vi.fn();
  const unsubscribe = observer.subscribe(listener);
  expect(observer.getSnapshot().status).toBe('ready');
  await Promise.resolve();
  listener.mockClear();
  const settle = client.store.optimisticUpdate(() => client.deleteRecord('User', '1'));
  await Promise.resolve();
  expect(listener).toHaveBeenCalled();
  expect(observer.getSnapshot().status).toBe('missing');
  settle();
  await Promise.resolve();
  expect(observer.getSnapshot().status).toBe('ready');
  unsubscribe();
});

test('awaits refresh completion, keeps usable data, exposes failures, and retries', async () => {
  const { client, fetchQuery } = setup();
  await client.request(request);
  const observer = client.observeRequest(request);
  const unsubscribe = observer.subscribe(() => {});
  await vi.waitFor(() => expect(observer.getSnapshot().isFetching).toBe(false));
  let reject!: (error: Error) => void;
  fetchQuery.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const refresh = observer.getSnapshot().refetch();
  const failure = expect(refresh).rejects.toThrow('Offline');
  await vi.waitFor(() => expect(fetchQuery).toHaveBeenCalledTimes(2));
  expect(observer.getSnapshot()).toMatchObject({
    data: { viewer: { id: '1' } },
    isFetching: true,
    status: 'ready',
  });
  reject(new Error('Offline'));
  await failure;
  expect(observer.getSnapshot()).toMatchObject({
    data: { viewer: { id: '1' } },
    error: new Error('Offline'),
    isFetching: false,
    status: 'ready',
  });
  fetchQuery.mockResolvedValueOnce({ id: '1', name: 'Grace' });
  await observer.getSnapshot().refetch();
  expect(observer.getSnapshot().error).toBeUndefined();
  expect((await client.readView(UserView, observer.getSnapshot().data!.viewer)).data).toMatchObject(
    { name: 'Grace' },
  );
  unsubscribe();
});

test('tracks the complete stale-while-revalidate lifecycle and reports its background error', async () => {
  const { client, fetchQuery } = setup();
  await client.request(request);
  let reject!: (error: Error) => void;
  fetchQuery.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const observer = client.observeRequest(request, { mode: 'stale-while-revalidate' });
  const unsubscribe = observer.subscribe(() => {});
  await vi.waitFor(() => expect(fetchQuery).toHaveBeenCalledTimes(2));
  expect(observer.getSnapshot()).toMatchObject({
    data: { viewer: { id: '1' } },
    isFetching: true,
    status: 'ready',
  });
  reject(new Error('Background failure'));
  await vi.waitFor(() =>
    expect(observer.getSnapshot()).toMatchObject({
      error: new Error('Background failure'),
      isFetching: false,
      status: 'ready',
    }),
  );
  unsubscribe();
});

test('deduplicates concurrent explicit refreshes and refuses network work for disabled or cache-only observers', async () => {
  const { client, fetchQuery } = setup();
  const observer = client.observeRequest(request);
  await observer.getSnapshot().refetch();
  const count = fetchQuery.mock.calls.length;
  await Promise.all([observer.getSnapshot().refetch(), observer.getSnapshot().refetch()]);
  expect(fetchQuery).toHaveBeenCalledTimes(count + 1);
  for (const options of [{ enabled: false }, { mode: 'cache-only' as const }]) {
    const passive = client.observeRequest(request, options);
    await expect(passive.getSnapshot().refetch()).rejects.toThrow(/disabled|cache-only/);
  }
  expect(fetchQuery).toHaveBeenCalledTimes(count + 1);
});
