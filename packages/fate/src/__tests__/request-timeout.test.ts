import { afterEach, expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { createPersistence } from '../persistence.ts';
import { clientRoot, clientValueRoot } from '../root.ts';
import { type Transport } from '../transport.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

afterEach(() => vi.useRealTimers());
const deferred = <T>() => Promise.withResolvers<T>();
const setup = () => {
  const pending = deferred<unknown>();
  const fetchQuery = vi.fn<NonNullable<Transport['fetchQuery']>>(() => pending.promise);
  const client = createClient({
    roots: { value: clientValueRoot<string>() },
    transport: { fetchById: vi.fn(), fetchQuery },
    types: [],
  });
  const request = { value: { value: true } } as const;
  return { client, fetchQuery, pending, request };
};

test('bounds a hung read and never writes its late response', async () => {
  vi.useFakeTimers();
  const { client, fetchQuery, pending, request } = setup();
  const result = Promise.resolve(client.request(request, { timeout: 20 })).catch((error) => error);
  await vi.advanceTimersByTimeAsync(20);
  expect(fetchQuery.mock.calls[0]?.[3]?.signal?.aborted).toBe(true);
  expect(await result).toMatchObject({ name: 'TimeoutError' });
  pending.resolve('late');
  await vi.advanceTimersByTimeAsync(0);
  expect(client.observeRequest(request, { mode: 'cache-only' }).getSnapshot().data).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

test('shares work while keeping each caller deadline independent', async () => {
  vi.useFakeTimers();
  const { client, fetchQuery, pending, request } = setup();
  const short = Promise.resolve(client.request(request, { timeout: 10 })).catch((error) => error);
  const long = client.request(request, { timeout: 100 });
  await vi.advanceTimersByTimeAsync(10);
  expect(fetchQuery).toHaveBeenCalledTimes(1);
  expect(fetchQuery.mock.calls[0]?.[3]?.signal?.aborted).toBe(false);
  expect(await short).toMatchObject({ name: 'TimeoutError' });
  pending.resolve('done');
  await expect(long).resolves.toEqual({ value: 'done' });
  expect(vi.getTimerCount()).toBe(0);
});

test.each([true, false])(
  'keeps an unbounded caller alive (bounded first: %s)',
  async (boundedFirst) => {
    vi.useFakeTimers();
    const { client, fetchQuery, pending, request } = setup();
    const bounded = () =>
      Promise.resolve(client.request(request, { timeout: 10 })).catch((error) => error);
    const first = boundedFirst ? bounded() : client.request(request);
    const second = boundedFirst ? client.request(request) : bounded();
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchQuery).toHaveBeenCalledTimes(1);
    pending.resolve('done');
    expect(await (boundedFirst ? first : second)).toMatchObject({ name: 'TimeoutError' });
    await expect(boundedFirst ? second : first).resolves.toEqual({ value: 'done' });
  },
);

test('rejects pre-aborted reads without fetching and preserves abort reasons', async () => {
  const { client, fetchQuery, request } = setup();
  const controller = new AbortController();
  const reason = new Error('Navigation cancelled');
  controller.abort(reason);
  const result = Promise.resolve(client.request(request, { signal: controller.signal })).catch(
    (error) => error,
  );
  await Promise.resolve();
  expect(fetchQuery).not.toHaveBeenCalled();
  expect(await result).toBe(reason);
});

test('aborts all roots when a request is cancelled without accepting late records', async () => {
  type User = { __typename: 'User'; id: string; name: string };
  const UserView = view<User>()({ name: true });
  const controller = new AbortController();
  const byId = deferred<Array<unknown>>();
  const list = deferred<any>();
  const query = deferred<unknown>();
  const transport: Transport = {
    fetchById: vi.fn(() => byId.promise),
    fetchList: vi.fn(() => list.promise),
    fetchQuery: vi.fn(() => query.promise),
  };
  const client = createClient({
    roots: {
      user: clientRoot<User, 'User'>('User'),
      users: clientRoot<Array<User>, 'User'>('User'),
    },
    transport,
    types: [{ type: 'User' }],
  });
  const request = client.request(
    {
      user: { id: '1', view: UserView },
      users: { list: { items: { node: UserView } } },
    },
    { signal: controller.signal },
  );
  const result = Promise.resolve(request).catch((error) => error);
  controller.abort();
  expect(await result).toMatchObject({ name: 'AbortError' });
  byId.resolve([{ id: '1', name: 'late' }]);
  list.resolve({
    items: [{ node: { id: '2', name: 'late' } }],
    pagination: { hasNext: false, hasPrevious: false },
  });
  query.resolve(null);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(client.store.read('User:1')).toBeUndefined();
  expect(client.store.read('User:2')).toBeUndefined();
});

test('preserves render promise and deadline across equivalent inline options', async () => {
  vi.useFakeTimers();
  const { client, pending, request } = setup();
  const first = client.prepareRequestForRender(request, { timeout: 20 });
  const result = Promise.resolve(first.promise).catch((error) => error);
  await vi.advanceTimersByTimeAsync(15);
  const second = client.prepareRequestForRender(request, { timeout: 20 });
  expect(second.promise).toBe(first.promise);
  expect(second.requestKey).toBe(first.requestKey);
  await vi.advanceTimersByTimeAsync(5);
  expect(await result).toMatchObject({ name: 'TimeoutError' });
  expect(client.prepareRequestForRender(request, { timeout: 20 }).promise).toBe(first.promise);
  pending.resolve('late');
});

test('allows an explicit retry after timeout and refreshes rejected render gates', async () => {
  vi.useFakeTimers();
  const { client, fetchQuery, request } = setup();
  const first = client.prepareRequestForRender(request, { timeout: 10 });
  const result = Promise.resolve(first.promise).catch((error) => error);
  await vi.advanceTimersByTimeAsync(10);
  expect(await result).toMatchObject({ name: 'TimeoutError' });
  fetchQuery.mockResolvedValueOnce('retry');
  await expect(client.request(request, { mode: 'network-only', timeout: 100 })).resolves.toEqual({
    value: 'retry',
  });
  await expect(client.prepareRequestForRender(request, { timeout: 10 }).promise).resolves.toEqual({
    value: 'retry',
  });
});

test('keeps cached data after an observer refresh times out', async () => {
  vi.useFakeTimers();
  const { client, fetchQuery, request } = setup();
  fetchQuery.mockResolvedValueOnce('cached');
  await client.request(request);
  const observer = client.observeRequest(request, { timeout: 10 });
  const unsubscribe = observer.subscribe(vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  const result = observer
    .getSnapshot()
    .refetch()
    .catch((error) => error);
  await vi.advanceTimersByTimeAsync(10);
  expect(await result).toMatchObject({ name: 'TimeoutError' });
  expect(observer.getSnapshot()).toMatchObject({
    data: { value: 'cached' },
    error: { name: 'TimeoutError' },
    isFetching: false,
  });
  unsubscribe();
});

test('bounds stale-while-revalidate background work while returning cached data', async () => {
  vi.useFakeTimers();
  const { client, fetchQuery, pending, request } = setup();
  fetchQuery.mockResolvedValueOnce('cached');
  await client.request(request);
  await expect(
    client.request(request, { mode: 'stale-while-revalidate', timeout: 10 }),
  ).resolves.toEqual({ value: 'cached' });
  await vi.advanceTimersByTimeAsync(10);
  expect(fetchQuery.mock.calls[1]?.[3]?.signal?.aborted).toBe(true);
  pending.resolve('late');
  await vi.advanceTimersByTimeAsync(0);
  await expect(client.request(request)).resolves.toEqual({ value: 'cached' });
  expect(vi.getTimerCount()).toBe(0);
});

test.each([-1, Number.NaN, Infinity, 2 ** 31])('rejects unsupported timeout %s', (timeout) => {
  const { client, request } = setup();
  expect(() => client.request(request, { timeout })).toThrow(/timeout/i);
});

test('times out persistence initialization without starting a late network request', async () => {
  vi.useFakeTimers();
  const storage = memoryStorage();
  const unlocked = Promise.withResolvers<void>();
  const scan = storage.scan;
  storage.scan = async (...args) => {
    await unlocked.promise;
    return scan(...args);
  };
  const fetchQuery = vi.fn(async () => 'network');
  const client = createClient({
    persistence: createPersistence({ key: 'timeout', storage }),
    roots: { value: clientValueRoot<string>() },
    transport: { fetchById: vi.fn(), fetchQuery },
    types: [],
  });
  const result = Promise.resolve(client.request({ value: { value: true } }, { timeout: 10 })).catch(
    (error) => error,
  );
  await vi.advanceTimersByTimeAsync(10);
  expect(await result).toMatchObject({ name: 'TimeoutError' });
  expect(fetchQuery).not.toHaveBeenCalled();
  unlocked.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchQuery).not.toHaveBeenCalled();
  client.persistence!.dispose();
});

test('a refetch recipe can outlive its cancelled request when another selection needs it', async () => {
  vi.useFakeTimers();
  type User = { __typename: 'User'; id: string; name: string; username: string };
  const UserView = view<User>()({ name: true });
  const pending = Promise.withResolvers<unknown>();
  const fetchQuery = vi.fn<NonNullable<Transport['fetchQuery']>>(() => pending.promise);
  const client = createClient({
    roots: { user: clientRoot<User, 'User'>('User'), viewer: clientRoot<User, 'User'>('User') },
    transport: { fetchById: vi.fn(), fetchQuery },
    types: [{ refetch: { args: { username: { field: 'username' } }, root: 'user' }, type: 'User' }],
  });
  client.write('User', { id: '1', username: 'ada' }, new Set(['username']));
  const short = Promise.resolve(
    client.request({ user: { id: '1', view: UserView } }, { timeout: 10 }),
  ).catch((error) => error);
  const long = client.request({ viewer: { id: '1', view: UserView } }, { timeout: 100 });
  await vi.advanceTimersByTimeAsync(10);
  expect(await short).toMatchObject({ name: 'TimeoutError' });
  expect(fetchQuery).toHaveBeenCalledTimes(1);
  expect(fetchQuery.mock.calls[0][3]?.signal?.aborted).toBe(false);
  pending.resolve({ id: '1', name: 'Ada', username: 'ada' });
  await expect(long).resolves.toMatchObject({ viewer: { id: '1' } });
  expect(client.store.read('User:1')?.name).toBe('Ada');
});

test('releaseRequest clears rejected render gates with timeout options', async () => {
  vi.useFakeTimers();
  const { client, fetchQuery, request } = setup();
  const first = client.prepareRequestForRender(request, { timeout: 10 });
  const result = Promise.resolve(first.promise).catch((error) => error);
  await vi.advanceTimersByTimeAsync(10);
  expect(await result).toMatchObject({ name: 'TimeoutError' });
  client.releaseRequest(request, 'cache-first');
  fetchQuery.mockResolvedValueOnce('retry');
  const retry = client.prepareRequestForRender(request, { timeout: 10 });
  expect(retry.promise).not.toBe(first.promise);
  await expect(retry.promise).resolves.toEqual({ value: 'retry' });
});

test('a failed compound read cancels its unfinished operations and cleans up the deadline', async () => {
  vi.useFakeTimers();
  const error = new Error('Unavailable');
  const fetchQuery = vi.fn<NonNullable<Transport['fetchQuery']>>((name) =>
    name === 'bad' ? Promise.reject(error) : new Promise(() => {}),
  );
  const client = createClient({
    roots: { bad: clientValueRoot<string>(), hung: clientValueRoot<string>() },
    transport: { fetchById: vi.fn(), fetchQuery },
    types: [],
  });
  await expect(
    client.request({ bad: { value: true }, hung: { value: true } }, { timeout: 100 }),
  ).rejects.toBe(error);
  expect(fetchQuery.mock.calls[1][3]?.signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
