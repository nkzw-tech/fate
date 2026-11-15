import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { readOptimisticField, withOptimisticSnapshot } from '../optimistic-snapshot.ts';
import { createPersistence } from '../persistence.ts';
import { clientRoot } from '../root.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

test.each(['parent', 'child'] as const)(
  'a stale tab cannot overwrite a newer embedded %s snapshot on disk',
  async (newerField) => {
    type Post = {
      __typename: 'Post';
      id: string;
      stats: { comments: number; likes: number } | null;
    };
    const Detail = view<Post>()({ id: true, stats: { comments: true, likes: true } });
    const detail = { post: { id: '1', view: Detail } };
    const storage = memoryStorage();
    const dispose: Array<() => void> = [];
    const setup = (offline = false) => {
      const fetchById = vi.fn(async () => {
        if (offline) {
          throw new Error('Offline');
        }
        return [
          withOptimisticSnapshot({ id: '1', stats: { comments: 8, likes: 8 } }, { revision: 8 }),
        ];
      });
      const client = createClient({
        persistence: createPersistence({ key: 'embedded-revisions', online: () => false, storage }),
        roots: { post: clientRoot('Post') },
        transport: { fetchById },
        types: [{ fields: { stats: { embedded: 'Stats' } }, type: 'Post' }],
      });
      const retain = client.retain(detail);
      dispose.push(() => {
        retain.dispose();
        client.persistence!.dispose();
      });
      return { client, fetchById, session: client.persistence! };
    };
    try {
      const first = setup();
      await first.client.request(detail);
      await first.session.flush();
      const second = setup(true);
      await second.client.request(detail);
      await second.session.flush();

      first.client.write(
        'Post',
        withOptimisticSnapshot(
          { id: '1', stats: newerField === 'parent' ? null : { likes: 10 } },
          { revision: 10 },
        ),
        new Set(['id', newerField === 'parent' ? 'stats' : 'stats.likes']),
      );
      await first.session.flush();
      second.client.write(
        'Post',
        withOptimisticSnapshot(
          { id: '1', stats: newerField === 'child' ? null : { likes: 9 } },
          { revision: 9 },
        ),
        new Set(['id', newerField === 'child' ? 'stats' : 'stats.likes']),
      );
      await second.session.flush();

      const restored = setup(true);
      await restored.client.request(detail);
      expect(restored.fetchById).not.toHaveBeenCalled();
      const record = restored.client.store.read('Post:1');
      expect(record?.stats).toEqual(newerField === 'parent' ? null : { comments: 8, likes: 10 });
      expect(readOptimisticField(record, 'stats.likes')?.revision).toBe(10);

      // A genuinely newer replacement must still be accepted from the stale tab.
      const stats = newerField === 'parent' ? { comments: 11, likes: 11 } : null;
      second.client.write(
        'Post',
        withOptimisticSnapshot({ id: '1', stats }, { revision: 11 }),
        new Set(['id', 'stats.comments', 'stats.likes']),
      );
      await second.session.flush();
      const latest = setup(true);
      await latest.client.request(detail);
      expect(latest.fetchById).not.toHaveBeenCalled();
      expect(latest.client.store.read('Post:1')?.stats).toEqual(stats);
      expect(readOptimisticField(latest.client.store.read('Post:1'), 'stats.likes')?.revision).toBe(
        11,
      );
    } finally {
      for (const cleanup of dispose) {
        cleanup();
      }
    }
  },
);

test('concurrent tabs preserve edits to independent embedded fields', async () => {
  type Note = { __typename: 'Note'; id: string; profile: { bio: string; name: string } };
  const Detail = view<Note>()({ id: true, profile: { bio: true, name: true } });
  const detail = { note: { id: '1', view: Detail } };
  const storage = memoryStorage();
  const clients: Array<any> = [];
  const setup = (offline = false) => {
    const fetchById = vi.fn(async () => {
      if (offline) {
        throw new Error('Offline');
      }
      return [{ __typename: 'Note', id: '1', profile: { bio: 'Old bio', name: 'Old name' } }];
    });
    const roots = { note: clientRoot('Note') };
    const client = createClient<[typeof roots, Record<never, never>]>({
      persistence: createPersistence({ key: 'embedded-audit', online: () => false, storage }),
      roots,
      transport: { fetchById },
      types: [{ fields: { profile: { embedded: 'Profile' } }, type: 'Note' }],
    });
    clients.push(client);
    return { client, fetchById, session: client.persistence! };
  };
  try {
    const first = setup();
    const firstRetain = first.client.retain(detail);
    await first.client.request(detail);
    await first.session.flush();
    const second = setup(true);
    const secondRetain = second.client.retain(detail);
    await second.client.request(detail);
    await second.session.flush();
    first.client.write(
      'Note',
      { id: '1', profile: { name: 'New name' } },
      new Set(['id', 'profile.name']),
    );
    await first.session.flush();
    second.client.write(
      'Note',
      { id: '1', profile: { bio: 'New bio' } },
      new Set(['id', 'profile.bio']),
    );
    await second.session.flush();
    const next = setup(true);
    await next.client.request(detail);
    expect(next.fetchById).not.toHaveBeenCalled();
    expect(next.client.store.read('Note:1')).toMatchObject({
      profile: { bio: 'New bio', name: 'New name' },
    });
    firstRetain.dispose();
    secondRetain.dispose();
  } finally {
    for (const client of clients) {
      client.persistence.dispose();
    }
  }
});
