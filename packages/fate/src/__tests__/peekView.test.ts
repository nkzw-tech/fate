import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { defer } from '../defer.ts';
import { createPersistence } from '../persistence.ts';
import { getSelectionPlan } from '../selection.ts';
import type { ViewRef } from '../types.ts';
import { view } from '../view.ts';
import { createClientStateFixture } from './fixtures/client-state.ts';
import { memoryStorage } from './persistenceStorage.ts';

type User = { __typename: 'User'; details: string; id: string; name: string };
const Name = view<User>()({ name: true });
const setup = () => {
  const fetchById = vi.fn(async (_type: string, ids: ReadonlyArray<string | number>) =>
    ids.map((id) => ({ id, name: 'Fetched' })),
  );
  const client = createClient({ transport: { fetchById }, types: [{ type: 'User' }] });
  return { client, fetchById };
};

test('peekView reads current client state synchronously with view masking and memo fields', async () => {
  const { computedView, make, scalarView } = createClientStateFixture(2);
  const client = make();
  const ref = client.ref('State', 'main', scalarView);
  const initial = client.peekView(scalarView, ref);
  expectTypeOf(initial?.data.count).toEqualTypeOf<number | undefined>();
  expect(initial?.data).toEqual({ __typename: 'State', count: 0, id: 'main' });
  expect(client.peekView(scalarView, ref)).toBe(initial);
  expect(await client.readView(scalarView, ref)).toBe(initial);
  const increment = client.mutations.increment();
  expect(client.peekView(scalarView, ref)?.data.count).toBe(1);
  await increment;
  await client.mutations.replace();
  expect(
    client.peekView(computedView, client.ref('State', 'main', computedView))?.data.titles,
  ).toBe('Task 0, Task 1');
});

test('peekView returns undefined for missing records and fields without fetching', async () => {
  const { client, fetchById } = setup();
  const ref = client.ref('User', '1', Name);
  const Empty = view<User>()({});
  expect(client.peekView(Empty, client.ref('User', 'missing', Empty))).toBeUndefined();
  expect(client.peekView(Name, ref)).toBeUndefined();
  client.write('User', { id: '1' }, new Set(['id']));
  expect(client.peekView(Name, ref)).toBeUndefined();
  expect(fetchById).not.toHaveBeenCalled();
  const fetched = await client.readView(Name, ref);
  expect(fetched.data.name).toBe('Fetched');
  expect(fetchById).toHaveBeenCalledTimes(1);
  expect(client.peekView(Name, ref)).toBe(fetched);
});

test('peekView does not reuse incomplete snapshots from stalled reads', async () => {
  const { client, fetchById } = setup();
  const Details = view<User>()({ details: true, name: true });
  const ref = client.ref('User', '1', Details);
  client.write('User', { id: '1', name: 'Cached' }, new Set(['id', 'name']));
  fetchById.mockResolvedValueOnce([]);
  const partial = await client.readView(Details, ref);
  expect(partial.data.details).toBeUndefined();
  fetchById.mockClear();
  expect(client.peekView(Details, ref)).toBeUndefined();
  expect(fetchById).not.toHaveBeenCalled();
});

test('peekView does not retain records or load missing related fields', () => {
  type Parent = { __typename: 'Parent'; child: User; id: string };
  const fetchById = vi.fn(async () => []);
  const client = createClient({
    transport: { fetchById },
    types: [{ fields: { child: { type: 'User' } }, type: 'Parent' }, { type: 'User' }],
  });
  const ParentView = view<Parent>()({ child: { name: true } });
  const ref = client.ref('Parent', 'parent', ParentView);
  client.write('Parent', { child: { id: '1' }, id: 'parent' }, new Set(['id', 'child.id']));
  expect(client.peekView(ParentView, ref)).toBeUndefined();
  client.write('User', { id: '1', name: 'Child' }, new Set(['id', 'name']));
  expect(client.peekView(ParentView, ref)?.data.child.name).toBe('Child');
  client.gc();
  expect(client.peekView(ParentView, ref)).toBeUndefined();
  expect(fetchById).not.toHaveBeenCalled();
});

test('peekView follows optimistic values, rollbacks and resolved identities', () => {
  const { client, fetchById } = setup();
  client.write('User', { id: 'real', name: 'Saved' }, new Set(['id', 'name']));
  const ref = client.ref('User', 'temporary', Name);
  client.resolveOptimisticEntity('User:temporary', 'User:real');
  expect(client.peekView(Name, ref)?.data.name).toBe('Saved');
  const settle = client.store.optimisticUpdate(() =>
    client.write('User', { id: 'real', name: 'Pending' }, new Set(['name'])),
  );
  expect(client.peekView(Name, ref)?.data.name).toBe('Pending');
  settle();
  expect(client.peekView(Name, ref)?.data.name).toBe('Saved');
  expect(fetchById).not.toHaveBeenCalled();
});

test('peekView resolves parameterized views and leaves deferred fields unfetched', () => {
  const { client, fetchById } = setup();
  const Localized = view<User>()(({ locale }: { locale: string }) => ({
    name: { args: { locale } },
  }));
  const english = Localized({ locale: 'en' });
  client.write(
    'User',
    { id: '1', name: 'Hello' },
    new Set(['name']),
    getSelectionPlan(english, null),
  );
  expect(client.peekView(Localized, client.ref('User', '1', english))?.data.name).toBe('Hello');
  expect(
    client.peekView(Localized, client.ref('User', '1', Localized({ locale: 'ja' }))),
  ).toBeUndefined();
  const Deferred = view<User>()({ details: defer(true), name: true });
  client.write('User', { id: '1', name: 'Name' }, new Set(['name']));
  const snapshot = client.peekView(Deferred, client.ref('User', '1', Deferred));
  expect(snapshot?.data.name).toBe('Name');
  expect(snapshot?.data.details).toBeDefined();
  expect(fetchById).not.toHaveBeenCalled();
});

test('peekView keeps reference validation errors distinct from cache misses', () => {
  const { client, fetchById } = setup();
  expect(() => client.peekView(Name, {} as ViewRef<'User'>)).toThrow("Expected 'id'");
  expect(() => client.peekView(Name, { id: '1' } as ViewRef<'User'>)).toThrow(
    "Expected '__typename'",
  );
  expect(() => client.peekView(Name, { __typename: 'User', id: '1' } as ViewRef<'User'>)).toThrow(
    'Expected the provided ref to include',
  );
  expect(fetchById).not.toHaveBeenCalled();
});

test('peekView does not restore persistence and returns undefined until persistence is ready', async () => {
  const storage = memoryStorage();
  const gate = Promise.withResolvers<void>();
  const read = storage.read;
  const readSpy = vi.spyOn(storage, 'read').mockImplementation(async (key) => {
    await gate.promise;
    return read(key);
  });
  const scanSpy = vi.spyOn(storage, 'scan');
  const fetchById = vi.fn(async () => []);
  const client = createClient({
    persistence: createPersistence({ key: 'peek', storage }),
    transport: { fetchById },
    types: [{ type: 'User' }],
  });
  const ref = client.ref('User', '1', Name);
  client.write('User', { id: '1', name: 'Cached' }, new Set(['id', 'name']));
  try {
    expect(client.peekView(Name, ref)).toBeUndefined();
    gate.resolve();
    await client.persistence!.ready;
    readSpy.mockClear();
    scanSpy.mockClear();
    expect(client.peekView(Name, ref)?.data.name).toBe('Cached');
    expect(client.peekView(Name, client.ref('User', 'missing', Name))).toBeUndefined();
    await Promise.resolve();
    expect(readSpy).not.toHaveBeenCalled();
    expect(scanSpy).not.toHaveBeenCalled();
    expect(fetchById).not.toHaveBeenCalled();
  } finally {
    gate.resolve();
    client.persistence!.dispose();
  }
  expect(client.peekView(Name, ref)).toBeUndefined();
});
