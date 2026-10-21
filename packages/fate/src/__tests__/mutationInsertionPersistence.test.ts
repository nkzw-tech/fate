import { afterEach, expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { mutation } from '../mutation.ts';
import type { PersistenceSession } from '../persistence-types.ts';
import { createPersistence } from '../persistence.ts';
import { FateRequestError } from '../protocol.ts';
import { clientRoot } from '../root.ts';
import { getSelectionPlan } from '../selection.ts';
import type { SelectionOf } from '../types.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

type Note = { __typename: 'Note'; id: string; title: string };
type Folder = { __typename: 'Folder'; id: string; notes: Array<Note> };
const NoteView = view<Note>()({ id: true, title: true });
const FolderView = view<Folder>()(
  ({ category }: { category: string }) =>
    ({ id: true, notes: { args: { category }, items: { node: NoteView } } }) as const,
);
const roots = { notes: clientRoot('Note'), otherNotes: clientRoot('Note') };
const mutations = { create: mutation<Note, { title: string }, Note>('Note') };
const sessions: Array<PersistenceSession> = [];
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
});
const makeClient = (
  storage: ReturnType<typeof memoryStorage>,
  online: () => boolean,
  mutate = vi.fn().mockResolvedValue({ id: 'server', title: 'Confirmed' }),
  gcReleaseBufferSize = 10,
) => {
  const client = createClient<[typeof roots, typeof mutations]>({
    gcReleaseBufferSize,
    mutations,
    persistence: createPersistence({ key: 'insertion', online, storage }),
    roots,
    transport: {
      fetchById: async () => [],
      fetchList: async (name) => ({
        items: [{ cursor: name, node: { id: name, title: 'Existing' } }],
        pagination: { hasNext: false, hasPrevious: false },
      }),
      mutateDurably: mutate,
    },
    types: [
      { fields: { title: 'scalar' }, type: 'Note' },
      { fields: { notes: { listOf: 'Note' } }, type: 'Folder' },
    ],
  });
  sessions.push(client.persistence!);
  return { client, session: client.persistence! };
};
const first = { notes: { list: NoteView } };
const second = { otherNotes: { list: NoteView } };

test('durable scoped insertions restore exact targets and reconcile after offline restart', async () => {
  const storage = memoryStorage();
  let online = false;
  const before = makeClient(storage, () => online, undefined, 0);
  const retained = before.client.retain(first);
  const into = (await before.client.request(first)).notes;
  await before.client.request(second);
  const targetKey = before.client.store.dehydrate().lists[0][0];
  const submission = before.client.mutations
    .create({
      input: { title: 'Pending' },
      insert: { into, position: 'before' },
      optimistic: { id: 'temporary', title: 'Pending' },
      view: NoteView,
    })
    .catch(() => {});
  retained.dispose();
  before.client.gc();
  expect(before.client.store.getListState(targetKey)).toBeDefined();
  expect(before.client.getRequestResult(first).notes.map(({ id }) => id)).toEqual(['notes']);
  await vi.waitFor(() => expect(before.session.getSnapshot().mutations).toHaveLength(1));
  expect(before.client.getRequestResult(first).notes.map(({ id }) => id)).toEqual([
    'temporary',
    'notes',
  ]);
  await before.session.flush();
  before.session.dispose();
  await submission;

  const mutate = vi.fn().mockResolvedValue({ id: 'server', title: 'Confirmed' });
  const after = makeClient(storage, () => online, mutate);
  await after.session.ready;
  expect(after.client.getRequestResult(first).notes.map(({ id }) => id)).toEqual([
    'temporary',
    'notes',
  ]);
  await after.client.request(second);
  online = true;
  after.session.retry();
  await vi.waitFor(() => expect(after.session.getSnapshot().mutations).toHaveLength(0));
  expect(after.client.getRequestResult(first).notes.map(({ id }) => id)).toEqual([
    'server',
    'notes',
  ]);
  expect(after.client.getRequestResult(second).otherNotes.map(({ id }) => id)).toEqual([
    'otherNotes',
  ]);
  expect(mutate).toHaveBeenCalledOnce();
});

test('restored multi-list optimistic insertions roll back on a terminal refusal', async () => {
  const storage = memoryStorage();
  let online = false;
  const before = makeClient(storage, () => online);
  const a = (await before.client.request(first)).notes;
  const b = (await before.client.request(second)).otherNotes;
  const submission = before.client.mutations
    .create({
      input: { title: 'Pending' },
      insert: [
        { into: a, position: 'before' },
        { into: b, position: 'after' },
      ],
      optimistic: { id: 'temporary', title: 'Pending' },
      view: NoteView,
    })
    .catch(() => {});
  await vi.waitFor(() => expect(before.session.getSnapshot().mutations).toHaveLength(1));
  await before.session.flush();
  before.session.dispose();
  await submission;
  const mutate = vi.fn().mockRejectedValue(new FateRequestError('BAD_REQUEST', 'Refused'));
  const after = makeClient(storage, () => online, mutate);
  await after.session.ready;
  online = true;
  after.session.retry();
  await vi.waitFor(() => expect(after.session.getSnapshot().mutations[0]?.status).toBe('failed'));
  expect(after.client.getRequestResult(first).notes.map(({ id }) => id)).toEqual(['notes']);
  expect(after.client.getRequestResult(second).otherNotes.map(({ id }) => id)).toEqual([
    'otherNotes',
  ]);
});

test('durable insertion restores a nested owner and preserves its argument scope', async () => {
  const storage = memoryStorage();
  let online = false;
  const before = makeClient(storage, () => online);
  const read = (client: typeof before.client, category: string) => {
    const selection = FolderView({ category });
    return client.readView<Folder, SelectionOf<typeof selection>, typeof selection>(
      selection,
      client.ref('Folder', 'folder', selection),
    );
  };
  for (const category of ['draft', 'published']) {
    const plan = getSelectionPlan(FolderView({ category }), null);
    before.client.write(
      'Folder',
      { id: 'folder', notes: [{ id: category, title: category }] },
      plan.paths,
      plan,
    );
  }
  const into = (await read(before.client, 'draft')).data.notes;
  const submission = before.client.mutations
    .create({
      input: { title: 'Pending' },
      insert: { into, position: 'before' },
      optimistic: { id: 'temporary', title: 'Pending' },
      view: NoteView,
    })
    .catch(() => {});
  await vi.waitFor(() => expect(before.session.getSnapshot().mutations).toHaveLength(1));
  await before.session.flush();
  before.session.dispose();
  await submission;
  const after = makeClient(storage, () => online);
  await after.session.ready;
  expect((await read(after.client, 'draft')).data.notes.items.map(({ node }) => node.id)).toEqual([
    'temporary',
    'draft',
  ]);
  online = true;
  after.session.retry();
  await vi.waitFor(() => expect(after.session.getSnapshot().mutations).toHaveLength(0));
  expect((await read(after.client, 'draft')).data.notes.items.map(({ node }) => node.id)).toEqual([
    'server',
    'draft',
  ]);
  expect(
    (await read(after.client, 'published')).data.notes.items.map(({ node }) => node.id),
  ).toEqual(['published']);
});
