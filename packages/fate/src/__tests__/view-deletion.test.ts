import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { mutation } from '../mutation.ts';
import { clientRoot } from '../root.ts';
import { view } from '../view.ts';

type User = { __typename: 'User'; id: string; username: string };
type Lobby = { __typename: 'Lobby'; creator: User; id: string; slug: string };
const LobbyView = view<Lobby>()({ creator: { id: true, username: true }, id: true, slug: true });
const lobby: Lobby = {
  __typename: 'Lobby',
  creator: { __typename: 'User', id: 'owner', username: 'Sam' },
  id: '1',
  slug: 'test-lobby',
};
const roots = { lobby: clientRoot<Lobby | null, 'Lobby'>('Lobby') };
const request = { lobby: { args: { slug: lobby.slug }, view: LobbyView } };
const mutations = { remove: mutation<Lobby, { id: string }, Partial<Lobby>>('Lobby') };
const setup = () => {
  const response = Promise.withResolvers<Partial<Lobby>>();
  const fetchQuery = vi.fn().mockResolvedValue(lobby);
  const fetchById = vi.fn(async () => []);
  const client = createClient<[typeof roots, typeof mutations]>({
    gcReleaseBufferSize: 0,
    mutations,
    roots,
    transport: { fetchById, fetchQuery, mutate: vi.fn().mockReturnValue(response.promise) },
    types: [
      {
        fields: { creator: { type: 'User' } },
        refetch: { args: { slug: { field: 'slug' } }, root: 'lobby' },
        type: 'Lobby',
      },
      { type: 'User' },
    ],
  });
  return { client, fetchById, fetchQuery, response };
};

test.each([true, false])(
  'query readers retire optimistic deletions and restore rollbacks (commit: %s)',
  async (commit) => {
    const { client, fetchById, fetchQuery, response } = setup();
    await client.request(request);
    const retained = client.retain(request);
    const observer = client.observeRequest(request, { mode: 'cache-only' });
    const unsubscribe = observer.subscribe(() => {});
    const initial = client.getRequestResult(request).lobby;
    const deletion = client.mutations.remove({ delete: true, input: { id: lobby.id } });
    const settled = deletion.catch(() => undefined);
    try {
      expect(client.getRequestResult(request).lobby).toBeNull();
      expect(observer.getSnapshot()).toMatchObject({ data: undefined, status: 'missing' });
      expect(fetchQuery).toHaveBeenCalledTimes(1);
      expect(fetchById).not.toHaveBeenCalled();
      if (commit) {
        response.resolve({ id: lobby.id, slug: lobby.slug });
        await deletion;
        expect(client.getRequestResult(request).lobby).toBeNull();
        expect(observer.getSnapshot()).toMatchObject({ data: undefined, status: 'missing' });
      } else {
        response.reject(new Error('Cannot delete'));
        await settled;
        expect(client.getRequestResult(request).lobby).toMatchObject({ id: initial!.id });
        expect(observer.getSnapshot().status).toBe('ready');
        expect(
          (await client.readView(LobbyView, client.getRequestResult(request).lobby!)).data,
        ).toMatchObject({ creator: { id: 'owner' } });
      }
    } finally {
      response.resolve({ id: lobby.id });
      await settled;
      unsubscribe();
      retained.dispose();
    }
  },
);

test('a view read overtaken by confirmed deletion never fulfills a fabricated entity', async () => {
  const { client, fetchQuery, response } = setup();
  client.write('Lobby', { id: lobby.id, slug: lobby.slug }, new Set(['id', 'slug']));
  const read = Promise.withResolvers<Lobby>();
  fetchQuery.mockReturnValueOnce(read.promise);
  const ref = client.ref('Lobby', lobby.id, LobbyView);
  const snapshot = Promise.resolve(client.readView(LobbyView, ref));
  const failure = expect(snapshot).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(fetchQuery).toHaveBeenCalledTimes(1);
  const deletion = client.mutations.remove({ delete: true, input: { id: lobby.id } });
  response.resolve({ id: lobby.id, slug: lobby.slug });
  await deletion;
  read.resolve(lobby);
  await failure;
  expect(client.store.read('Lobby:1')).toBeUndefined();
});

test('eviction remains a cache miss and server null remains an authoritative result', async () => {
  const { client, fetchById, fetchQuery } = setup();
  await client.request(request);
  client.gc();
  const observer = client.observeRequest(request, { mode: 'cache-only' });
  const unsubscribe = observer.subscribe(() => {});
  try {
    expect(observer.getSnapshot()).toMatchObject({ data: undefined, status: 'missing' });
    expect(fetchQuery).toHaveBeenCalledTimes(1);
    expect(fetchById).not.toHaveBeenCalled();
    fetchQuery.mockResolvedValueOnce(null);
    await client.request(request);
    expect(observer.getSnapshot()).toMatchObject({ data: { lobby: null }, status: 'ready' });
  } finally {
    unsubscribe();
  }
});
