import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { z } from 'zod';
import { clientSchema, type ClientOf, type EntityOf } from '../client-schema.ts';
import { createClient } from '../client.ts';
import { dataView, list } from '../data-view.ts';
import { createPersistence } from '../persistence.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

const task = dataView<{ id: string; title: string }>('Task')({ id: true, title: true });
const schema = clientSchema({
  roots: { board: { id: 'main', type: 'Board' } },
  types: {
    Board: {
      defaults: (id) => ({
        id,
        tags: ['work'],
        tasks: ['a', 'b', 'c'].map((id) => ({ id, title: id })),
      }),
      view: dataView<{
        id: string;
        tags: Array<string>;
        tasks: Array<{ id: string; title: string }>;
      }>('Board')({ id: true, tags: true, tasks: list(task) }),
    },
    Task: { defaults: (id) => ({ id, title: '' }), view: task },
  },
});
const Board = view<EntityOf<ClientOf<typeof schema>, 'Board'>>()({
  tasks: { id: true, title: true },
});

test('removal stages membership changes, preserves records and composes with appends', async () => {
  const client = createClient().registerClientSchema(schema, ({ mutation }) => ({
    edit: mutation('Board', {
      resolve: ({ store }) => {
        expectTypeOf<
          Parameters<typeof store.remove<'Board', 'tasks'>>[3]
        >().toEqualTypeOf<string>();
        store.remove('Board', 'main', 'tasks', 'b', 'b', 'missing');
        expect(store.get('Board', 'main')?.tasks?.map(({ id }) => id)).toEqual(['a', 'c']);
        store.append('Board', 'main', 'tasks', 'b');
        store.remove('Board', 'main', 'tasks', 'a');
        store.create('Task', { id: 'd', title: 'd' });
        store.append('Board', 'main', 'tasks', 'd');
        store.remove('Board', 'main', 'tasks', 'd');
        store.remove('Board', 'main', 'tasks');
        expect(store.has('Task', 'a')).toBe(true);
        expect(store.has('Task', 'd')).toBe(true);
        return store.get('Board', 'main')?.tasks?.map(({ id }) => id);
      },
    }),
    noop: mutation('Board', {
      resolve: ({ store }) => store.remove('Board', 'main', 'tasks', 'missing', 'missing'),
    }),
  }));
  const { board } = await client.request({ board: { view: Board } });
  expect((await client.readView(Board, board)).data.tasks.map(({ id }) => id)).toEqual([
    'a',
    'b',
    'c',
  ]);
  const published: Array<Array<string>> = [];
  const unsubscribe = client.store.subscribe('Board:main', () => {
    published.push(client.readView(Board, board).value.data.tasks.map(({ id }) => id));
  });
  try {
    expect((await client.mutations.edit()).result).toEqual(['c', 'b']);
    expect((await client.readView(Board, board)).data.tasks.map(({ id }) => id)).toEqual([
      'c',
      'b',
    ]);
    expect(published).toEqual([['c', 'b']]);
    expect(client.store.read('Task:a')).toBeDefined();
    expect(client.store.read('Task:d')).toBeDefined();
    await client.mutations.noop();
    expect(published).toEqual([['c', 'b']]);
  } finally {
    unsubscribe();
  }
});

test.each(['append', 'remove'] as const)(
  'removal preserves overlapping %s commits',
  async (operation) => {
    const pending = Promise.withResolvers<void>();
    const client = createClient().registerClientSchema(schema, ({ mutation }) => ({
      first: mutation('Board', {
        resolve: async ({ store }) => {
          store.remove('Board', 'main', 'tasks', 'b');
          await pending.promise;
        },
      }),
      second: mutation('Board', {
        resolve: ({ store }) => {
          if (operation === 'append') {
            store.create('Task', { id: 'd', title: 'd' });
            store.append('Board', 'main', 'tasks', 'd');
          } else {
            store.remove('Board', 'main', 'tasks', 'c');
          }
        },
      }),
    }));
    const first = client.mutations.first();
    await client.mutations.second();
    pending.resolve();
    await first;
    const { board } = await client.request({ board: { view: Board } });
    expect((await client.readView(Board, board)).data.tasks.map(({ id }) => id)).toEqual(
      operation === 'append' ? ['a', 'c', 'd'] : ['a'],
    );
  },
);

test('failed resolvers discard removals and validate the owner and stored list field', async () => {
  const client = createClient().registerClientSchema(schema, ({ mutation }) => ({
    fail: mutation('Board', {
      resolve: ({ store }) => {
        store.remove('Board', 'main', 'tasks', 'b');
        throw new Error('Abort edit');
      },
    }),
    invalid: mutation('Board', {
      input: z.object({ missingOwner: z.boolean() }),
      resolve: ({ input, store }) => {
        if (input.missingOwner) {
          store.remove('Board', 'missing', 'tasks', 'a');
        } else {
          // @ts-expect-error Scalar arrays are not normalized client lists.
          store.remove('Board', 'main', 'tags', 'work');
        }
      },
    }),
  }));
  await expect(client.mutations.fail()).rejects.toThrow('Abort edit');
  await expect(client.mutations.invalid({ input: { missingOwner: true } })).rejects.toThrow(
    'missing client record',
  );
  await expect(client.mutations.invalid({ input: { missingOwner: false } })).rejects.toThrow(
    'not a stored client list',
  );
  const { board } = await client.request({ board: { view: Board } });
  expect((await client.readView(Board, board)).data.tasks.map(({ id }) => id)).toEqual([
    'a',
    'b',
    'c',
  ]);
});

test('removal persists atomically and rolls back when saving fails', async () => {
  const storage = memoryStorage();
  const open = () =>
    createClient({
      persistence: createPersistence({ key: 'remove-tasks', storage }),
    }).registerClientSchema(schema, ({ mutation }) => ({
      remove: mutation('Board', {
        resolve: ({ store }) => store.remove('Board', 'main', 'tasks', 'b'),
      }),
    }));
  const client = open();
  try {
    const { board } = await client.request({ board: { view: Board } });
    vi.spyOn(storage, 'writeBatch').mockRejectedValueOnce(new Error('Disk full'));
    await expect(client.mutations.remove()).rejects.toThrow('Disk full');
    expect((await client.readView(Board, board)).data.tasks.map(({ id }) => id)).toEqual([
      'a',
      'b',
      'c',
    ]);
    await client.mutations.remove();
    const reopened = open();
    try {
      const { board } = await reopened.request({ board: { view: Board } });
      expect((await reopened.readView(Board, board)).data.tasks.map(({ id }) => id)).toEqual([
        'a',
        'c',
      ]);
    } finally {
      reopened.persistence!.dispose();
    }
  } finally {
    client.persistence!.dispose();
  }
});
