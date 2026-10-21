import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { toEntityId } from '../ref.ts';
import type { SelectionOf } from '../types.ts';
import { view } from '../view.ts';

type User = { __typename: 'User'; email: string; id: string; name: string };
const Name = view<User>()({ id: true, name: true });

test('render failures stay stable through failed retries and recover after an imperative read', async () => {
  const pending = Promise.withResolvers<Array<Partial<User>>>();
  const fetchById = vi.fn(() => pending.promise);
  const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'User' }] });
  const ref = client.ref('User', 'A', Name);
  const failure = new Error('Initial failure');
  const first = client.readViewForRender<User, SelectionOf<typeof Name>, typeof Name>(Name, ref);
  expect(client.readViewForRender<User, SelectionOf<typeof Name>, typeof Name>(Name, ref)).toBe(
    first,
  );
  pending.reject(failure);
  await expect(first).rejects.toBe(failure);
  expect(() =>
    client.readViewForRender<User, SelectionOf<typeof Name>, typeof Name>(Name, ref),
  ).toThrow(failure);
  expect(fetchById).toHaveBeenCalledTimes(1);

  fetchById.mockRejectedValueOnce(new Error('Retry failed'));
  await expect(
    client.readView<User, SelectionOf<typeof Name>, typeof Name>(Name, ref),
  ).rejects.toThrow('Retry failed');
  expect(() =>
    client.readViewForRender<User, SelectionOf<typeof Name>, typeof Name>(Name, ref),
  ).toThrow(failure);
  expect(fetchById).toHaveBeenCalledTimes(2);

  fetchById.mockResolvedValueOnce([{ id: 'A', name: 'Recovered' }]);
  await expect(
    client.readView<User, SelectionOf<typeof Name>, typeof Name>(Name, ref),
  ).resolves.toMatchObject({ data: { name: 'Recovered' } });
  expect(
    client.readViewForRender<User, SelectionOf<typeof Name>, typeof Name>(Name, ref).value.data
      .name,
  ).toBe('Recovered');
  expect(fetchById).toHaveBeenCalledTimes(3);
});

test('mounted reader scopes do not retain another reader’s failed lifecycle', async () => {
  const fetchById = vi.fn().mockRejectedValueOnce(new Error('First reader failed'));
  const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'User' }] });
  const ref = client.ref('User', 'A', Name);
  const firstScope = {};
  await expect(
    client.readViewForRender<User, SelectionOf<typeof Name>, typeof Name>(Name, ref, firstScope),
  ).rejects.toThrow('First reader failed');
  const retry = Promise.withResolvers<Array<Partial<User>>>();
  fetchById.mockReturnValueOnce(retry.promise);
  const next = client.readViewForRender<User, SelectionOf<typeof Name>, typeof Name>(Name, ref, {});
  // A separate initial consumer shares the transport, but owns its error gate.
  expect(client.readViewForRender<User, SelectionOf<typeof Name>, typeof Name>(Name, ref)).toBe(
    next,
  );
  expect(() =>
    client.readViewForRender<User, SelectionOf<typeof Name>, typeof Name>(Name, ref, firstScope),
  ).toThrow('First reader failed');
  expect(fetchById).toHaveBeenCalledTimes(2);
  retry.resolve([{ id: 'A', name: 'Recovered' }]);
  await next;
  expect(
    client.readViewForRender<User, SelectionOf<typeof Name>, typeof Name>(Name, ref, firstScope)
      .value.data.name,
  ).toBe('Recovered');
});

test('a changed missing selection does not reuse an older render failure', async () => {
  const Contact = view<User>()({ email: true, id: true, name: true });
  const fetchById = vi.fn().mockRejectedValueOnce(new Error('Missing contact'));
  const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'User' }] });
  const ref = client.ref('User', 'A', Contact);
  client.write('User', { id: 'A' }, new Set(['id']));
  await expect(
    client.readViewForRender<User, SelectionOf<typeof Contact>, typeof Contact>(Contact, ref),
  ).rejects.toThrow('Missing contact');
  client.write('User', { id: 'A', name: 'Name' }, new Set(['name']));
  fetchById.mockResolvedValueOnce([{ email: 'user@example.com', id: 'A' }]);
  await expect(
    client.readViewForRender<User, SelectionOf<typeof Contact>, typeof Contact>(Contact, ref),
  ).resolves.toMatchObject({
    data: { email: 'user@example.com', name: 'Name' },
  });
  expect(fetchById).toHaveBeenLastCalledWith('User', ['A'], new Set(['email']), undefined);
});

test('optimistic identity resolution preserves render failure stability', async () => {
  const fetchById = vi.fn().mockRejectedValueOnce(new Error('Resolved identity failed'));
  const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'User' }] });
  const ref = client.ref('User', 'optimistic:A', Name);
  client.resolveOptimisticEntity(toEntityId('User', 'optimistic:A'), toEntityId('User', 'A'));
  await expect(
    client.readViewForRender<User, SelectionOf<typeof Name>, typeof Name>(Name, ref),
  ).rejects.toThrow('Resolved identity failed');
  expect(() =>
    client.readViewForRender<User, SelectionOf<typeof Name>, typeof Name>(Name, ref),
  ).toThrow('Resolved identity failed');
  expect(fetchById).toHaveBeenCalledTimes(1);
  fetchById.mockResolvedValueOnce([{ id: 'A', name: 'Recovered' }]);
  await expect(
    client.readView<User, SelectionOf<typeof Name>, typeof Name>(Name, ref),
  ).resolves.toMatchObject({
    data: { id: 'A', name: 'Recovered' },
  });
  expect(fetchById).toHaveBeenCalledTimes(2);
});
