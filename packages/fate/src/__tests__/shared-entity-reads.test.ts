import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { clientRoot } from '../root.ts';
import type { ReadContext } from '../transport.ts';
import type { AnyRecord, SelectionOf } from '../types.ts';
import { view } from '../view.ts';

type User = { __typename: 'User'; avatar: string; id: string; name: string };
const Avatar = view<User>()({ avatar: true });
const Profile = view<User>()({ avatar: true, name: true });
const Name = view<User>()(({ locale }: { locale: string }) => ({ name: { args: { locale } } }));
const record = { avatar: '/avatar.png', id: '1', name: 'Ada' };
const request = { user: { id: '1', view: Profile } };
const setup = () => {
  const fetchById = vi.fn(
    async (
      _type: string,
      _ids: Array<string | number>,
      _fields: Set<string>,
      _args?: AnyRecord,
      _context?: ReadContext,
    ): Promise<Array<AnyRecord>> => [record],
  );
  const client = createClient({
    roots: { user: clientRoot('User') },
    transport: { fetchById },
    types: [{ fields: { name: 'scalar' }, type: 'User' }],
  });
  const readAvatar = () =>
    client.readView<User, SelectionOf<typeof Avatar>, typeof Avatar>(
      Avatar,
      client.ref('User', '1', Avatar),
    );
  return { client, fetchById, readAvatar };
};

test('a missing view field joins a wider pending fetch for the same entity', async () => {
  const { client, fetchById, readAvatar } = setup();
  const response = Promise.withResolvers<Array<AnyRecord>>();
  fetchById.mockReturnValueOnce(response.promise);
  const broad = client.request(request);
  const narrow = readAvatar();
  expect(fetchById).toHaveBeenCalledTimes(1);

  response.resolve([record]);
  expect((await narrow).data.avatar).toBe('/avatar.png');
  await broad;
  expect(fetchById).toHaveBeenCalledTimes(1);
});

test('reads for the same field with different arguments stay separate', async () => {
  const { client, fetchById } = setup();
  const response = Promise.withResolvers<Array<AnyRecord>>();
  fetchById.mockReturnValueOnce(response.promise).mockResolvedValueOnce([{ id: '1', name: 'Ja' }]);
  const broad = client.request({
    user: { id: '1', view: { ...Name({ locale: 'en' }), ...Avatar } },
  });
  const narrow = client.readView(Name, client.ref('User', '1', Name({ locale: 'ja' })));
  await expect(narrow).resolves.toMatchObject({ data: { name: 'Ja' } });
  expect(fetchById).toHaveBeenCalledTimes(2);
  response.resolve([record]);
  await broad;
});

test.each(['omitted', 'rejected'] as const)(
  'a view fetches its missing field when the joined entity is %s',
  async (outcome) => {
    const { client, fetchById, readAvatar } = setup();
    const response = Promise.withResolvers<Array<AnyRecord>>();
    fetchById.mockReturnValueOnce(response.promise);
    const broad = client.request(request).catch(() => undefined);
    const narrow = readAvatar();
    expect(fetchById).toHaveBeenCalledTimes(1);

    if (outcome === 'omitted') {
      response.resolve([]);
    } else {
      response.reject(new Error('profile unavailable'));
    }
    expect((await narrow).data.avatar).toBe('/avatar.png');
    await broad;
    expect(fetchById).toHaveBeenCalledTimes(2);
    expect(fetchById.mock.calls[1][2]).toEqual(new Set(['avatar']));
  },
);

test('cancelling the wider request keeps its fetch alive for the joined view', async () => {
  const { client, fetchById, readAvatar } = setup();
  const response = Promise.withResolvers<Array<AnyRecord>>();
  fetchById.mockReturnValueOnce(response.promise);
  const controller = new AbortController();
  const broad = client.request(request, { signal: controller.signal });
  const rejected = expect(broad).rejects.toMatchObject({ name: 'AbortError' });
  const narrow = readAvatar();
  const signal = fetchById.mock.calls[0][4]?.signal;
  expect(signal).toBeDefined();

  controller.abort();
  await rejected;
  expect(signal?.aborted).toBe(false);
  response.resolve([record]);
  expect((await narrow).data.avatar).toBe('/avatar.png');
  expect(fetchById).toHaveBeenCalledTimes(1);
});
