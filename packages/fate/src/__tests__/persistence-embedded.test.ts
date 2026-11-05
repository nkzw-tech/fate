import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { createPersistence } from '../persistence.ts';
import { clientRoot } from '../root.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

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
