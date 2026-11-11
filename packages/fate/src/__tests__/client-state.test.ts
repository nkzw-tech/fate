import { buildSchema, graphql } from 'graphql';
import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { z } from 'zod';
import { alias } from '../alias.ts';
import { clientQuery, clientSchema, type EntityOf } from '../client-schema.ts';
import { createClient } from '../client.ts';
import { createGraphQLArgumentSchema } from '../codegen/graphql.ts';
import type { DataViewResult } from '../data-view.ts';
import { defer } from '../defer.ts';
import { createGraphQLTransport } from '../graphqlTransport.ts';
import { mutation } from '../mutation.ts';
import { createNodeRef, getNodeRefId, isNodeRef } from '../node-ref.ts';
import { createPersistence } from '../persistence.ts';
import type { FateLiveConnectionEvent } from '../protocol.ts';
import { toEntityId } from '../ref.ts';
import { clientRoot } from '../root.ts';
import { getSelectionPlan } from '../selection.ts';
import { memo, dataView, field, list } from '../server/dataView.ts';
import { ConnectionTag, type ConnectionMetadata } from '../types.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

const todo = dataView<{ id: string; title: string }>('Todo')({ id: true, title: true });
const summary = vi.fn((_item, deps) => `${deps.count} tasks`);
type UIData = { count: number; id: string; todos: Array<{ id: string; title: string }> };
const ui = dataView<UIData>('UI')({
  count: true,
  id: true,
  summary: memo<{ id: string }, string>({
    resolve: summary,
    select: { count: field('count') },
  }),
  titles: memo({
    resolve: (_item: UIData, { titles = [] }) => {
      expectTypeOf(titles).toEqualTypeOf<Array<string>>();
      return titles.join(', ');
    },
    select: { titles: field('todos.title') },
  }),
  todos: list(todo),
});

test('client queries resolve typed arguments and track records and lookup dependencies', async () => {
  const Titles = view<UI>()({ todos: { id: true, title: true } });
  const storage = memoryStorage();
  const fetchById = vi.fn();
  const open = () =>
    createClient({
      persistence: createPersistence({ key: 'client-query', storage }),
      transport: { fetchById },
    }).registerClientSchema(
      clientSchema({
        ...schema,
        roots: {
          ...schema.roots,
          task: clientQuery('Todo', {
            args: z.object({ id: z.string() }),
            resolve: ({ args }) => args.id,
          }),
          taskByTitle: clientQuery('Todo', {
            args: z.object({ title: z.string() }),
            resolve: ({ args, read }) =>
              read(Titles, 'UI', 'main')?.todos.find(({ title }) => title === args.title)?.id ??
              null,
          }),
        },
      }),
      ({ mutation }) => ({
        add: mutation('Todo', {
          resolve: ({ store }) => {
            store.create('Todo', { id: 'a', title: 'Apple' });
            store.append('UI', 'main', 'todos', 'a');
          },
        }),
        remove: mutation('Todo', {
          resolve: ({ store }) => {
            store.update('UI', 'main', { todos: [] });
            store.delete('Todo', 'a');
          },
        }),
        rename: mutation('Todo', {
          resolve: ({ store }) => store.update('Todo', 'a', { title: 'Apricot' }),
        }),
      }),
    );
  const client = open();
  const Task = view<EntityOf<typeof client, 'Todo'>>()({ title: true });
  const request = {
    task: { args: { id: 'a' }, view: Task },
    taskByTitle: { args: { title: 'Apple' }, view: Task },
  };
  expect(await client.request(request)).toEqual({ task: null, taskByTitle: null });
  const observer = client.observeRequestResult(request);
  const changes = vi.fn();
  const unsubscribe = observer.subscribe(changes);
  try {
    await client.mutations.add();
    expect(changes).toHaveBeenCalled();
    const { task, taskByTitle } = observer.getSnapshot();
    expectTypeOf(task?.__typename).toEqualTypeOf<'Todo' | undefined>();
    expect(task).toEqual(taskByTitle);
    expect((await client.readView(Task, task!)).data.title).toBe('Apple');

    const reopened = open();
    try {
      const { taskByTitle } = await reopened.request(request);
      expect(taskByTitle?.id).toBe('a');
    } finally {
      reopened.persistence!.dispose();
    }

    changes.mockClear();
    await client.mutations.rename();
    expect(changes).toHaveBeenCalled();
    expect(observer.getSnapshot()).toEqual({ task, taskByTitle: null });
    await client.mutations.remove();
    expect(observer.getSnapshot()).toEqual({ task: null, taskByTitle: null });
    expect(await client.request(request)).toEqual({ task: null, taskByTitle: null });
    expect(fetchById).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
    client.persistence!.dispose();
  }
});
const schema = clientSchema({
  roots: { ui: { id: 'main', type: 'UI' } },
  types: {
    Todo: { defaults: (id: string | number) => ({ id, title: '' }), view: todo },
    UI: { defaults: (id: string | number) => ({ count: 0, id, todos: [] }), view: ui },
  },
});
const makeClient = () =>
  createClient({ gcReleaseBufferSize: 0 }).registerClientSchema(schema, ({ mutation }) => ({
    'todo.add': mutation('Todo', {
      input: z.object({ id: z.string(), title: z.string() }),
      resolve: ({ input, store }) => {
        const task = store.create('Todo', input);
        store.update('UI', 'main', { todos: [...store.get('UI', 'main')!.todos!, task] });
        return task;
      },
    }),
    'ui.increment': mutation('UI', {
      input: z.object({ amount: z.number() }),
      resolve: ({ input, store }) =>
        store.update('UI', 'main', { count: (store.get('UI', 'main')?.count ?? 0) + input.amount }),
    }),
  }));

test('overlapping client mutations append to the confirmed list in commit order', async () => {
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const client = createClient().registerClientSchema(schema, ({ mutation }) => ({
    append: mutation('Todo', {
      input: z.object({ id: z.enum(['first', 'second']) }),
      resolve: async ({ input: { id }, store }) => {
        store.create('Todo', { id, title: id });
        store.append('UI', 'main', 'todos', id, id);
        expect(store.get('UI', 'main')?.todos?.map((todo) => todo.id)).toEqual([id]);
        await (id === 'first' ? first.promise : second.promise);
      },
    }),
  }));
  const firstAppend = client.mutations.append({ input: { id: 'first' } });
  const secondAppend = client.mutations.append({ input: { id: 'second' } });
  second.resolve();
  await secondAppend;
  first.resolve();
  await firstAppend;

  const { ui } = await client.request({ ui: { view: UIView } });
  const { data } = await client.readView(UIView, ui);
  expect(data.todos.map((todo) => todo.id)).toEqual(['second', 'first']);
});
type UI = EntityOf<ReturnType<typeof makeClient>, 'UI'>;
const UIView = view<UI>()({
  count: true,
  id: true,
  summary: true,
  titles: true,
  todos: { id: true, title: true },
});

test('client-only roots, mutations, memo views, relationships and GC need no transport', async () => {
  const client = makeClient();
  const { ui } = await client.request({ ui: { view: UIView } });
  expect((await client.readView(UIView, ui)).data).toMatchObject({
    count: 0,
    summary: '0 tasks',
    titles: '',
    todos: [],
  });
  const pending = client.mutations.ui.increment({ input: { amount: 2 } });
  // Synchronous local effects commit before the returned promise settles.
  expect(client.store.read('UI:main')?.count).toBe(2);
  await pending;
  await client.mutations.todo.add({ input: { id: 'a', title: 'Apple' } });
  expect((await client.readView(UIView, ui)).data).toMatchObject({
    count: 2,
    summary: '2 tasks',
    titles: 'Apple',
    todos: [{ title: 'Apple' }],
  });
  client.gc();
  expect(client.store.read('UI:main')).toBeDefined();
  expect(client.store.read('Todo:a')).toBeDefined();
  await client.request({ ui: { view: UIView } }, { mode: 'network-only' });
  expect((await client.readView(UIView, ui)).data.count).toBe(2);
  expect(makeClient().store.read('UI:main')?.count).toBe(0);
  expectTypeOf<UI['count']>().toEqualTypeOf<number>();
  expectTypeOf<UI['summary']>().toEqualTypeOf<string>();
});

test('client mutations accept readonly scalar arrays and preserve their tuple types', async () => {
  const client = createClient().registerClientSchema(
    clientSchema({
      roots: { save: { id: 'main', type: 'Save' } },
      types: {
        Save: {
          defaults: (id) => ({ id, turns: ['start', 0] }),
          view: dataView<{ id: string; turns: readonly [string, number] }>('Save')({
            id: true,
            turns: true,
          }),
        },
      },
    }),
    ({ mutation }) => ({
      advance: mutation('Save', {
        resolve: ({ store }) => {
          const turns = ['next', 1] as const;
          store.update('Save', 'main', { turns });
        },
      }),
    }),
  );
  const Save = view<EntityOf<typeof client, 'Save'>>()({ turns: true });
  await client.mutations.advance();
  const { data } = await client.readView(Save, client.ref('Save', 'main', Save));
  expectTypeOf(data.turns).toEqualTypeOf<readonly [string, number]>();
  expect(data.turns).toEqual(['next', 1]);
});

test('views can select an entire object-valued client field', async () => {
  type SaveData = { id: string; snapshot: { player: { name: string }; turn: number } };
  const snapshot = { player: { name: 'Ada' }, turn: 2 };
  const client = createClient().registerClientSchema(
    clientSchema({
      roots: { save: { id: 'main', type: 'Save' } },
      types: {
        Save: {
          defaults: (id) => ({ id, snapshot }),
          view: dataView<SaveData>('Save')({ id: true, snapshot: true }),
        },
      },
    }),
  );
  const Save = view<EntityOf<typeof client, 'Save'>>()({ snapshot: true });
  const { data } = await client.readView(Save, client.ref('Save', 'main', Save));
  expectTypeOf(data.snapshot).toEqualTypeOf<SaveData['snapshot']>();
  expect(data.snapshot).toEqual(snapshot);
});

test('views preserve recursive JSON fields without expanding recursive array selections', async () => {
  type Json = string | number | boolean | null | Array<Json> | { [key: string]: Json };
  type Document = { __typename: 'Document'; content: Record<string, Json>; id: string };
  const content: Document['content'] = {
    nested: { items: [1, null, { title: 'Draft' }, [true, ['text']]] },
  };
  const DocumentView = view<Document>()({ content: true });
  const client = createClient().registerClientSchema(
    clientSchema({
      roots: { document: { id: 'main', type: 'Document' } },
      types: {
        Document: {
          defaults: (id) => ({ content, id }),
          view: dataView<Omit<Document, '__typename'>>('Document')({ content: true, id: true }),
        },
      },
    }),
    ({ mutation }) => ({
      update: mutation('Document', {
        resolve: ({ store }) => store.update('Document', 'main', { content }),
      }),
    }),
  );
  const LocalView = view<EntityOf<typeof client, 'Document'>>()({ content: true });
  await client.mutations.update();
  const ref = client.ref('Document', 'main', { ...DocumentView, ...LocalView });
  const { data } = await client.readView(DocumentView, ref);
  expectTypeOf(data.content).toEqualTypeOf<Record<string, Json>>();
  expect(data.content).toEqual(content);
  const local = await client.readView(LocalView, ref);
  expectTypeOf(local.data.content).toEqualTypeOf<Record<string, Json>>();
  expect(local.data.content).toEqual(content);
});

test('memo dependencies are masked, subscribed, memoized and invalidated', async () => {
  const client = makeClient();
  const ComputedView = view<UI>()({ summary: true });
  const ref = client.ref<UI>('UI', 'main', ComputedView);
  const before = summary.mock.calls.length;
  const first = await client.readView(ComputedView, ref);
  expect(first.data).toEqual({ __typename: 'UI', summary: '0 tasks' });
  expect(first.coverage[0][1].has('count')).toBe(true);
  await client.readView(ComputedView, ref);
  expect(summary.mock.calls.length).toBe(before + 1);
  await client.mutations.ui.increment({ input: { amount: 3 } });
  expect((await client.readView(ComputedView, ref)).data.summary).toBe('3 tasks');
  expect(summary.mock.calls.length).toBe(before + 2);
});

test('memo object dependencies preserve scalar types and class results', async () => {
  class Decoded {
    #value: number;
    constructor(value: number) {
      this.#value = value;
    }
    value() {
      return this.#value;
    }
  }
  type Item = {
    __typename: 'Item';
    decoded: Decoded;
    history: readonly [number, string] | null;
    id: string;
    state: { values: ReadonlyArray<number> };
  };
  const resolve = vi.fn((value: number) => new Decoded(value));
  const client = createClient({
    roots: { item: clientRoot<Item, 'Item'>('Item') },
    types: [{ fields: { history: 'scalar', state: 'scalar' }, type: 'Item' }],
  }).registerClientSchema(
    clientSchema({
      typeExtensions: {
        Item: {
          defaults: () => ({}),
          view: dataView<Item>('Item')({
            decoded: memo({
              resolve: (_item: Item, { history, state }) => {
                expectTypeOf(state).toEqualTypeOf<Item['state']>();
                expectTypeOf(history).toEqualTypeOf<Item['history']>();
                return resolve(state.values[0] + (history?.[0] ?? 0));
              },
              select: { history: true, state: true },
            }),
            doubled: memo({
              resolve: (_item: Item, { decoded }) => {
                expectTypeOf(decoded).toEqualTypeOf<Decoded>();
                return decoded.value() * 2;
              },
              select: { decoded: true },
            }),
          }),
        },
      },
    }),
  );
  type ExtendedItem = EntityOf<typeof client, 'Item'>;
  expectTypeOf<ExtendedItem['decoded']>().toExtend<Decoded>();
  const ItemView = view<ExtendedItem>()({ decoded: true, doubled: true });
  client.write(
    'Item',
    { history: [3, 'saved'], id: 'a', state: { values: [2] } },
    new Set(['id', 'history', 'state']),
  );
  const ref = client.ref('Item', 'a', ItemView);
  const first = (await client.readView(ItemView, ref)).data;
  expect(first.decoded).toBeInstanceOf(Decoded);
  expect(first.decoded.value()).toBe(5);
  expect(first.doubled).toBe(10);
  expect((await client.readView(ItemView, ref)).data.decoded).toBe(first.decoded);
  expect(resolve).toHaveBeenCalledTimes(1);
  client.write('Item', { id: 'a', state: { values: [7] } }, new Set(['id', 'state']));
  expect((await client.readView(ItemView, ref)).data.doubled).toBe(20);
  expect(resolve).toHaveBeenCalledTimes(2);
});

test('whole relationship dependencies must select fields instead of exposing references', () => {
  const person = dataView<{ id: string; name: string }>('Person')({ id: true, name: true });
  expect(() =>
    createClient().registerClientSchema(
      clientSchema({
        types: {
          Item: {
            defaults: () => ({ person: { id: 'p', name: 'Ada' } }),
            view: dataView<{ person: { id: string; name: string } }>('Item')({
              label: memo({
                resolve: (_item: { person: { name: string } }, { person }) => person.name,
                select: { person: true },
              }),
              person,
            }),
          },
          Person: { defaults: (id) => ({ id, name: '' }), view: person },
        },
      }),
    ),
  ).toThrow("Dependency 'person' on 'Item.label' must select a field of the relationship");
});

test('equivalent memo arguments share results across independent views', async () => {
  const resolve = vi.fn((_item: { value: number }, { value }, _context, args) => ({
    value: value * (args?.factor ?? 1),
  }));
  const client = createClient().registerClientSchema(
    clientSchema({
      types: {
        Item: {
          defaults: () => ({ value: 2 }),
          view: dataView<{ value: number }>('Item')({
            derived: memo({ resolve, select: { value: true } }),
            value: true,
          }),
        },
      },
    }),
    ({ mutation }) => ({
      change: mutation('Item', {
        resolve: ({ store }) => store.update('Item', 'a', { value: 3 }),
      }),
    }),
  );
  client.write('Item', { id: 'a' }, new Set(['id']));
  type Item = EntityOf<typeof client, 'Item'>;
  const First = view<Item>()({ derived: { args: { factor: 2, options: { enabled: true } } } });
  const Second = view<Item>()({
    derived: { args: { factor: 2, options: { enabled: true } } },
    id: true,
  });
  const Other = view<Item>()({ derived: { args: { factor: 3 } } });
  const read = async (selection: typeof First | typeof Second | typeof Other) =>
    (await client.readView(selection, client.ref('Item', 'a', selection))).data.derived;
  const first = await read(First);
  expect(first).toEqual({ value: 4 });
  expect(await read(Second)).toBe(first);
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(await read(Other)).toEqual({ value: 6 });
  expect(await read(First)).toBe(first);
  expect(resolve).toHaveBeenCalledTimes(2);
  await client.mutations.change();
  const changed = await read(Second);
  expect(changed).toEqual({ value: 6 });
  expect(await read(First)).toBe(changed);
  expect(resolve).toHaveBeenCalledTimes(3);
});

test('a graph mutation publishes only its final state and failed resolvers publish nothing', async () => {
  const client = createClient().registerClientSchema(schema, ({ mutation }) => ({
    'ui.change': mutation('UI', {
      input: z.object({ fail: z.boolean() }),
      resolve: ({ input, store }) => {
        store.update('UI', 'main', { count: 1 });
        store.update('UI', 'main', { count: 2 });
        if (input.fail) {
          throw new Error('stop');
        }
        return store.get('UI', 'main');
      },
    }),
  }));
  const snapshots: Array<unknown> = [];
  client.store.subscribe('UI:main', () => snapshots.push(client.store.read('UI:main')?.count));
  await expect(client.mutations.ui.change({ input: { fail: true } })).rejects.toThrow('stop');
  expect(snapshots).toEqual([]);
  expect(client.store.read('UI:main')?.count).toBe(0);
  await client.mutations.ui.change({ input: { fail: false } });
  expect(snapshots).toEqual([2]);
});

test('staged child updates take precedence over a returned parent snapshot', async () => {
  const client = createClient().registerClientSchema(schema, ({ mutation }) => ({
    change: mutation('UI', {
      resolve: ({ store }) => {
        const snapshot = store.update('UI', 'main', { count: 1 });
        store.update('Todo', 'a', { title: 'After' });
        store.delete('Todo', 'b');
        return snapshot;
      },
    }),
  }));
  client.write(
    'UI',
    {
      id: 'main',
      todos: [
        { id: 'a', title: 'Before' },
        { id: 'b', title: 'Remove me' },
      ],
    },
    new Set(['id', 'todos', 'todos.id', 'todos.title']),
  );
  const { ui } = await client.request({ ui: { view: UIView } });
  const { result } = await client.mutations.change();
  expect(result?.todos?.[0].title).toBe('Before');
  expect((await client.readView(UIView, ui)).data).toMatchObject({
    count: 1,
    todos: [{ id: 'a', title: 'After' }],
  });
  expect(client.store.read('Todo:b')).toBeUndefined();
});

type ServerPost = { __typename: 'Post'; id: string; title: string };
const postFields = dataView<{ draft: string | null; expanded: boolean }>('Post')({
  displayTitle: memo<{ draft: string | null; expanded: boolean }, string>({
    resolve: (_post, deps) => String(deps.draft ?? deps.title),
    select: { draft: true, title: true },
  }),
  draft: true,
  expanded: true,
});
const postSchema = clientSchema({
  typeExtensions: {
    Post: { defaults: () => ({ draft: null, expanded: false }), view: postFields },
  },
});
const roots = { post: clientRoot<ServerPost, 'Post'>('Post') };
const mutations = {
  'post.save': mutation<ServerPost, { id: string; title: string }, ServerPost>('Post'),
};
const makeRemote = (
  save = async (input: { id: string; title: string }) => ({
    ...input,
    __typename: 'Post' as const,
  }),
) => {
  const fetch = vi.fn(
    async (_type: string, ids: Array<string | number>, select: Iterable<string>) => {
      const fields = [...select];
      expect(fields).not.toContain('expanded');
      expect(fields).not.toContain('draft');
      expect(fields).not.toContain('displayTitle');
      return ids.map((id) => ({ draft: 'malicious', expanded: true, id, title: 'Server title' }));
    },
  );
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    roots,
    transport: { fetchById: fetch, mutate: vi.fn((_name, input) => save(input)) as any },
    types: [{ type: 'Post' }],
  }).registerClientSchema(postSchema, ({ mutation }) => ({
    'post.edit': mutation('Post', {
      input: z.object({ draft: z.string(), id: z.string() }),
      resolve: ({ input, store }) => store.update('Post', input.id, { draft: input.draft }),
    }),
    'post.saveDraft': mutation('Post', {
      input: z.object({ id: z.string() }),
      resolve: async ({ input, mutateRemote, store }) => {
        const draft = store.get('Post', input.id)?.draft;
        store.update('Post', input.id, { expanded: true });
        const result = await mutateRemote('post.save', { id: input.id, title: draft ?? '' });
        store.update('Post', input.id, { draft: null, expanded: true });
        return { ...result, draft: null, expanded: true };
      },
    }),
  }));
  return { client, fetch };
};
type Post = EntityOf<ReturnType<typeof makeRemote>['client'], 'Post'>;
const PostView = view<Post>()({ displayTitle: true, draft: true, expanded: true, id: true });

test('extensions filter transport selections, initialize fields, mask dependencies and survive refetch', async () => {
  const { client, fetch } = makeRemote();
  const { post } = await client.request({ post: { id: 'p', view: PostView } });
  const data = (await client.readView(PostView, post)).data;
  expect(data).toEqual({
    __typename: 'Post',
    displayTitle: 'Server title',
    draft: null,
    expanded: false,
    id: 'p',
  });
  expect(fetch.mock.calls[0][2]).toContain('title');
  await client.mutations.post.edit({ input: { draft: 'Draft title', id: 'p' } });
  expect((await client.readView(PostView, post)).data.displayTitle).toBe('Draft title');
  await client.request({ post: { id: 'p', view: PostView } }, { mode: 'network-only' });
  expect((await client.readView(PostView, post)).data.draft).toBe('Draft title');
  const AliasView = view<Post>()({ expandedAlias: alias('expanded', true) });
  await client.request({ post: { id: 'p', view: AliasView } }, { mode: 'network-only' });
  expect([...fetch.mock.calls.at(-1)![2]]).toEqual(['id']);
});

test('dependency-free client computations fetch uncached server entities once', async () => {
  const fetchById = vi.fn(async (_type: string, ids: Array<string | number>) =>
    ids.map((id) => ({ id })),
  );
  const client = createClient<[typeof roots, Record<never, never>]>({
    roots,
    transport: { fetchById },
    types: [{ type: 'Post' }],
  }).registerClientSchema(
    clientSchema({
      typeExtensions: {
        Post: {
          defaults: () => ({}),
          view: dataView<ServerPost>('Post')({ constant: memo({ resolve: () => 42 }) }),
        },
      },
    }),
  );
  const ConstantView = view<EntityOf<typeof client, 'Post'>>()({ constant: true });
  const request = { post: { id: 'p', view: ConstantView } };
  const { post } = await client.request(request);

  expect((await client.readView(ConstantView, post)).data).toEqual({
    __typename: 'Post',
    constant: 42,
  });
  await client.request(request);
  expect(fetchById).toHaveBeenCalledExactlyOnceWith('Post', ['p'], new Set(['id']), undefined);
});

test('mixed mutations stage both local and remote effects, and discard local effects on failure', async () => {
  const server = Promise.withResolvers<ServerPost>();
  const { client } = makeRemote(() => server.promise);
  const { post } = await client.request({ post: { id: 'p', view: PostView } });
  await client.mutations.post.edit({ input: { draft: 'Draft title', id: 'p' } });
  const saves: Array<unknown> = [];
  client.store.subscribe(toEntityId('Post', 'p'), () =>
    saves.push({ ...client.store.read('Post:p') }),
  );
  const pending = client.mutations.post.saveDraft({ input: { id: 'p' } });
  expect(saves).toEqual([]);
  server.resolve({ __typename: 'Post', id: 'p', title: 'Saved title' });
  await pending;
  expect(saves).toHaveLength(1);
  expect((await client.readView(PostView, post)).data).toMatchObject({
    displayTitle: 'Saved title',
    draft: null,
    expanded: true,
  });
  const failing = makeRemote(async () => {
    throw new Error('offline');
  }).client;
  await failing.request({ post: { id: 'p', view: PostView } });
  await failing.mutations.post.edit({ input: { draft: 'Keep me', id: 'p' } });
  await expect(failing.mutations.post.saveDraft({ input: { id: 'p' } })).rejects.toThrow('offline');
  expect(failing.store.read('Post:p')?.draft).toBe('Keep me');
  expect(failing.store.read('Post:p')?.expanded).toBe(false);
});

test('mixed mutations request optimistic fields even without a view', async () => {
  type LikeablePost = { __typename: 'Post'; id: string; likes?: number };
  const roots = { post: clientRoot<LikeablePost, 'Post'>('Post') };
  const mutations = { like: mutation<LikeablePost, { id: string }, LikeablePost>('Post') };
  const mutate = vi.fn(async (_name: 'like', { id }: { id: string }, select: Set<string>) => ({
    __typename: 'Post' as const,
    id,
    ...(select.has('likes') && { likes: 2 }),
  }));
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    roots,
    transport: {
      fetchById: async () => [],
      // @ts-expect-error The transport method is generic; this mock only returns a Post.
      mutate,
    },
    types: [{ type: 'Post' }],
  }).registerClientSchema(postSchema, ({ mutation }) => ({
    likePost: mutation('Post', {
      input: z.object({ id: z.string() }),
      resolve: ({ input, mutateRemote }) => mutateRemote('like', input),
    }),
  }));

  client.write('Post', { id: 'p', likes: 0 }, new Set(['id', 'likes']));
  const pending = client.mutations.likePost({ input: { id: 'p' }, optimistic: { likes: 1 } });
  expect(client.store.read('Post:p')?.likes).toBe(1);
  await pending;
  expect(client.store.read('Post:p')?.likes).toBe(2);
  expect(mutate).toHaveBeenCalledWith('like', { id: 'p' }, new Set(['id', 'likes']));
});

test('hydration restores local roots over untouched defaults and keeps later client edits', async () => {
  const server = makeClient();
  await server.mutations.ui.increment({ input: { amount: 4 } });
  await server.mutations.todo.add({ input: { id: 'a', title: 'Hydrated task' } });
  const snapshot = structuredClone(server.dehydrate());
  const client = makeClient();
  client.hydrate(snapshot);
  const { ui } = await client.request({ ui: { view: UIView } });
  expect((await client.readView(UIView, ui)).data).toMatchObject({
    count: 4,
    summary: '4 tasks',
    todos: [{ title: 'Hydrated task' }],
  });
  await client.mutations.ui.increment({ input: { amount: 1 } });
  client.hydrate(snapshot);
  expect((await client.readView(UIView, ui)).data.count).toBe(5);
  expect(() => createClient().hydrate(snapshot)).toThrow('scope');
});

test('local relationships can load server records without sending local paths', async () => {
  type Person = { __typename: 'Person'; id: string; name: string };
  const person = dataView<Person>('Person')({ id: true, name: true });
  const selection = dataView<{ id: string; person: Person }>('Selection')({ id: true, person });
  const fetchById = vi.fn(async () => [{ id: 'a', name: 'Ada' }]);
  const client = createClient({
    transport: { fetchById },
    types: [{ type: 'Person' }],
  }).registerClientSchema(
    clientSchema({
      roots: { selection: { id: 'main', type: 'Selection' } },
      types: { Selection: { defaults: (id) => ({ id, person: { id: 'a' } }), view: selection } },
    }),
    ({ mutation }) => ({ refresh: mutation('Selection', { resolve: () => {} }) }),
  );
  // A relationship's name comes from its data view even when it is a server type.
  const SelectionView = view<EntityOf<typeof client, 'Selection'>>()({
    person: { name: true },
  });
  const { selection: selected } = await client.request({ selection: { view: SelectionView } });
  expect((await client.readView(SelectionView, selected)).data.person.name).toBe('Ada');
  expect(fetchById).toHaveBeenCalledWith('Person', ['a'], new Set(['name']), undefined);

  const PersonView = view<Person>()({ name: true });
  fetchById.mockResolvedValue([{ id: 'a', name: 'Updated' }]);
  await client.mutations.refresh({ invalidate: [client.ref('Person', 'a', PersonView)] });
  await client.request({ selection: { view: SelectionView } });
  expect((await client.readView(SelectionView, selected)).data.person.name).toBe('Updated');
  expect(fetchById).toHaveBeenCalledTimes(2);

  fetchById.mockResolvedValue([{ id: 'a', name: 'Fresh' }]);
  await client.request({ selection: { view: SelectionView } }, { mode: 'network-only' });
  expect((await client.readView(SelectionView, selected)).data.person.name).toBe('Fresh');
  expect(fetchById).toHaveBeenCalledTimes(3);
});

test('deferred client relationships load their targets without refetching query-only parents', async () => {
  type Person = { __typename: 'Person'; id: string; name: string };
  const person = dataView<Person>('Person')({ id: true, name: true });
  const fetchById = vi.fn(async (type: string, ids: Array<string | number>) => {
    if (type === 'Person') {
      return ids.map((id) => ({ id, name: 'Ada' }));
    }
    throw new Error('Posts are only available through their list.');
  });
  const client = createClient({
    transport: { fetchById },
    types: [{ type: 'Post' }, { type: 'Person' }],
  }).registerClientSchema(
    clientSchema({
      typeExtensions: {
        Post: {
          defaults: () => ({ selected: { id: 'a' } }),
          view: dataView<{ selected: Person }>('Post')({ selected: person }),
        },
      },
    }),
  );
  client.write('Post', { id: 'p' }, new Set(['id']));
  const PostView = view<EntityOf<typeof client, 'Post'>>()({
    selected: defer({ name: true }),
  });
  const { data } = await client.readView(PostView, client.ref('Post', 'p', PostView));
  expect(fetchById).not.toHaveBeenCalled();

  await expect(client.readDeferred(data.selected)).resolves.toMatchObject({
    data: { name: 'Ada' },
  });
  expect(fetchById).toHaveBeenCalledExactlyOnceWith('Person', ['a'], new Set(['name']), undefined);
});

test('local deletion updates relationships and garbage collection releases detached records', async () => {
  const client = createClient({ gcReleaseBufferSize: 0 }).registerClientSchema(
    schema,
    ({ mutation }) => ({
      add: mutation('Todo', {
        resolve: ({ store }) => {
          const task = store.create('Todo', { id: 'a', title: 'Transient' });
          store.update('UI', 'main', { todos: [task] });
          return task;
        },
      }),
      remove: mutation('Todo', {
        resolve: ({ store }) => {
          store.delete('Todo', 'a');
          const remaining = store.get('UI', 'main')!.todos!.map(({ id }) => id);
          expect(remaining).toEqual([]);
        },
      }),
    }),
  );
  await client.mutations.add();
  const { ui } = await client.request({ ui: { view: UIView } });
  expect((await client.readView(UIView, ui)).data.todos).toHaveLength(1);
  await client.mutations.remove();
  expect((await client.readView(UIView, ui)).data.todos).toEqual([]);
  expect(client.store.read('Todo:a')).toBeUndefined();
});

test('memo cycles and undeclared defaults fail during setup', () => {
  const cyclic = dataView<{ id: string }>('Cycle')({
    id: true,
    left: memo<{ id: string }, number>({ resolve: () => 0, select: { value: field('right') } }),
    right: memo<{ id: string }, number>({ resolve: () => 0, select: { value: field('left') } }),
  });
  expect(() =>
    createClient().registerClientSchema(
      clientSchema({ types: { Cycle: { defaults: (id) => ({ id }), view: cyclic } } }),
    ),
  ).toThrow('Cyclic');
  expect(() =>
    createClient().registerClientSchema(
      clientSchema({
        roots: { ui: { id: 'main', type: 'UI' } },
        types: { ...schema.types, UI: { defaults: (id) => ({ count: 0, id, typo: 1 }), view: ui } },
      }),
    ),
  ).toThrow('not a stored client field');
});

test('remote normalization preserves trusted nested client defaults', async () => {
  const notes = dataView<{ id: string; title: string }>('Note')({ id: true, title: true });
  const post = dataView<{ note: { id: string; title: string } }>('Post')({ note: notes });
  const client = createClient({
    transport: { fetchById: async () => [{ id: 'p', note: { id: 'injected', title: 'Wrong' } }] },
    types: [{ type: 'Post' }],
  }).registerClientSchema(
    clientSchema({
      typeExtensions: {
        Post: {
          defaults: (id) => ({ note: { id: `${id}-note`, title: 'Owner default' } }),
          view: post,
        },
      },
      types: { Note: { defaults: (id) => ({ id, title: 'Generic default' }), view: notes } },
    }),
  );
  const Post = view<EntityOf<typeof client, 'Post'>>()({ note: { title: true } });
  const ref = client.ref('Post', 'p', Post);
  expect((await client.readView(Post, ref)).data.note.title).toBe('Owner default');
  expect(client.store.read('Note:injected')).toBeUndefined();
});

test('local memo dependencies fetch through local-to-server relationships', async () => {
  type Person = { __typename: 'Person'; id: string; name: string };
  const person = dataView<Person>('Person')({ id: true, name: true });
  const selection = dataView<{ id: string; person: Person }>('Selection')({
    id: true,
    label: memo<{ id: string }, string>({
      resolve: (_item, { name }) => `Selected: ${name}`,
      select: { name: field('person.name') },
    }),
    person,
  });
  const fetchById = vi.fn(async () => [{ id: 'a', name: 'Ada' }]);
  const client = createClient({
    transport: { fetchById },
    types: [{ type: 'Person' }],
  }).registerClientSchema(
    clientSchema({
      roots: { selection: { id: 'main', type: 'Selection' } },
      types: { Selection: { defaults: (id) => ({ id, person: { id: 'a' } }), view: selection } },
    }),
  );
  const Selection = view<EntityOf<typeof client, 'Selection'>>()({ label: true });
  const { selection: ref } = await client.request({ selection: { view: Selection } });
  expect(fetchById).toHaveBeenCalledOnce();
  expect((await client.readView(Selection, ref)).data).toEqual({
    __typename: 'Selection',
    label: 'Selected: Ada',
  });
});

test('async client mutation results do not overwrite intervening field or relationship edits', async () => {
  const resumed = Promise.withResolvers<void>();
  const client = createClient().registerClientSchema(schema, ({ mutation }) => ({
    add: mutation('Todo', {
      resolve: ({ store }) => {
        const task = store.create('Todo', { id: 'new', title: 'Keep me' });
        store.update('UI', 'main', { todos: [task] });
        return task;
      },
    }),
    incrementLater: mutation('UI', {
      resolve: async ({ store }) => {
        const result = store.update('UI', 'main', { count: 1 });
        await resumed.promise;
        return result;
      },
    }),
  }));
  const pending = client.mutations.incrementLater();
  await client.mutations.add();
  resumed.resolve();
  const { result } = await pending;
  expect(result?.todos).toEqual([]);
  const { ui } = await client.request({ ui: { view: UIView } });
  expect((await client.readView(UIView, ui)).data).toMatchObject({
    count: 1,
    todos: [{ id: 'new', title: 'Keep me' }],
  });
});

test('client extension mutations preserve custom record identities', async () => {
  const client = createClient({
    types: [{ getId: (record) => (record as { slug: string }).slug, type: 'Post' }],
  }).registerClientSchema(postSchema, ({ mutation }) => ({
    edit: mutation('Post', {
      resolve: ({ store }) => {
        store.update('Post', 'first', { draft: 'First draft' });
        return store.update('Post', 'second', { expanded: true });
      },
    }),
  }));
  for (const [id, slug] of ['first', 'second'].entries()) {
    client.write('Post', { id, slug, title: slug }, new Set(['id', 'slug', 'title']));
  }
  const { result } = await client.mutations.edit();
  expect(result?.id).toBe(1);
  expect(client.store.read('Post:first')).toMatchObject({
    draft: 'First draft',
    id: 0,
    slug: 'first',
  });
  expect(client.store.read('Post:second')).toMatchObject({ expanded: true, id: 1, slug: 'second' });
  expect(client.store.read('Post:undefined')).toBeUndefined();
});

test('nested client writes are visible through every staged relationship before commit', async () => {
  const client = createClient().registerClientSchema(schema, ({ mutation }) => ({
    edit: mutation('UI', {
      resolve: ({ store }) => {
        store.update('UI', 'main', { todos: [{ id: 'a', title: 'New' }, { id: 'b' }] });
        expect(store.get('Todo', 'a')?.title).toBe('New');
        expect(store.get('Todo', 'b')?.title).toBe('');
        store.update('Todo', 'a', { title: `${store.get('Todo', 'a')?.title}!` });
        expect(store.get('UI', 'main')?.todos?.[0].title).toBe('New!');
        expect(client.store.read('Todo:a')?.title).toBe('Before');
        return store.get('UI', 'main');
      },
    }),
  }));
  client.write('Todo', { id: 'a', title: 'Before' }, new Set(['id', 'title']));
  await client.mutations.edit();
  const { ui } = await client.request({ ui: { view: UIView } });
  expect((await client.readView(UIView, ui)).data.todos).toMatchObject([
    { id: 'a', title: 'New!' },
    { id: 'b', title: '' },
  ]);
});

test('client mutation existence checks honor staged creates and deletes', async () => {
  const client = createClient().registerClientSchema(schema, ({ mutation }) => ({
    edit: mutation('Todo', {
      resolve: ({ store }) => {
        expect(() => store.update('Todo', 'missing', { title: 'Missing' })).toThrow(
          'Cannot update missing client record',
        );
        store.create('Todo', { id: 'new', title: 'Created' });
        store.update('Todo', 'new', { title: 'Updated before commit' });
        expect(() => store.create('Todo', { id: 'new' })).toThrow('already exists');
        store.delete('Todo', 'existing');
        expect(() => store.update('Todo', 'existing', { title: 'Deleted' })).toThrow(
          'Cannot update missing client record',
        );
        store.create('Todo', { id: 'existing', title: 'Recreated' });
        return store.update('Todo', 'existing', { title: 'Updated after recreation' });
      },
    }),
  }));
  client.write('Todo', { id: 'existing', title: 'Before' }, new Set(['id', 'title']));
  const { result } = await client.mutations.edit();
  expect(result?.title).toBe('Updated after recreation');
  expect(client.store.read('Todo:new')?.title).toBe('Updated before commit');
  expect(client.store.read('Todo:existing')?.title).toBe('Updated after recreation');
  expect(client.store.read('Todo:missing')).toBeUndefined();
});

test('mutation snapshots stay detached across shared relationships and later writes', async () => {
  const client = createClient().registerClientSchema(schema, ({ mutation }) => ({
    edit: mutation('UI', {
      resolve: ({ store }) => {
        const first = store.get('UI', 'main')!;
        const second = store.get('UI', 'main')!;
        first.todos![0].title = 'Changed snapshot';
        expect(first.todos![1].title).toBe('Before');
        expect(second.todos![0].title).toBe('Before');
        const updated = store.update('UI', 'main', { count: 1 });
        store.update('Todo', 'a', { title: 'After' });
        expect(updated.todos![0].title).toBe('Before');
        expect(store.get('UI', 'main')!.todos!.map(({ title }) => title)).toEqual([
          'After',
          'After',
        ]);
        return updated;
      },
    }),
  }));
  client.write(
    'UI',
    {
      id: 'main',
      todos: [
        { id: 'a', title: 'Before' },
        { id: 'a', title: 'Before' },
      ],
    },
    new Set(['id', 'todos', 'todos.id', 'todos.title']),
  );
  const { result } = await client.mutations.edit();
  result!.todos![0].title = 'Changed returned snapshot';
  expect(client.store.read('Todo:a')!.title).toBe('After');
});

test('batched client writes replace each relationship in order and preserve field coverage', async () => {
  const client = createClient().registerClientSchema(schema, ({ mutation }) => ({
    edit: mutation('UI', {
      resolve: ({ store }) => {
        store.update('UI', 'main', {
          todos: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
          ],
        });
        store.update('UI', 'main', { todos: [{ id: 'b', title: 'B2' }] });
        store.update('Todo', 'a', { title: 'A2' });
        return store.get('UI', 'main');
      },
    }),
  }));
  await client.mutations.edit();
  const { ui } = await client.request({ ui: { view: UIView } });
  expect((await client.readView(UIView, ui)).data.todos).toEqual([
    { __typename: 'Todo', id: 'b', title: 'B2' },
  ]);
  expect(client.store.read('Todo:a')!.title).toBe('A2');
});

test('mutation snapshots preserve cycle boundaries and safely copy scalar objects and sparse arrays', async () => {
  const cycle = dataView<{
    id: string;
    link: { id: string } | null;
    metadata: Record<string, unknown>;
  }>('Cycle')({
    id: true,
    link: dataView<{ id: string }>('Cycle')({ id: true }),
    metadata: true,
  });
  const client = createClient().registerClientSchema(
    clientSchema({
      types: { Cycle: { defaults: (id) => ({ id, link: null, metadata: {} }), view: cycle } },
    }),
    ({ mutation }) => ({
      read: mutation('Cycle', { resolve: ({ store }) => store.get('Cycle', 'a') }),
    }),
  );
  const values: Array<number> = [];
  values[1] = 2;
  const metadata = { ...JSON.parse('{"__proto__":{"marker":true}}'), values };
  client.write(
    'Cycle',
    { id: 'a', link: createNodeRef('Cycle:b'), metadata },
    new Set(['id', 'link', 'metadata']),
  );
  client.write(
    'Cycle',
    { id: 'b', link: createNodeRef('Cycle:a'), metadata: {} },
    new Set(['id', 'link', 'metadata']),
  );
  const { result } = await client.mutations.read();
  const copied = { ...metadata, values: [2] };
  expect(result?.metadata).toEqual(copied);
  expect(Object.hasOwn(result!.metadata!, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(result!.metadata)).toBe(Object.prototype);
  expect(result?.link).toEqual({
    __typename: 'Cycle',
    id: 'b',
    link: {
      __typename: 'Cycle',
      id: 'a',
      link: { __typename: 'Cycle', id: 'b' },
      metadata: copied,
    },
    metadata: {},
  });
  expect(values).toHaveLength(2);
  expect(0 in values).toBe(false);
});

test.each([null, { id: 'old', title: 'Old task' }])(
  'client mutations commit a single-object relationship over %j',
  async (initialTodo) => {
    const selection = dataView<{ id: string; todo: { id: string; title: string } | null }>(
      'Selection',
    )({ id: true, todo });
    const client = createClient().registerClientSchema(
      clientSchema({
        roots: { selection: { id: 'main', type: 'Selection' } },
        types: {
          Selection: { defaults: (id) => ({ id, todo: initialTodo }), view: selection },
          Todo: schema.types.Todo,
        },
      }),
      ({ mutation }) => ({
        choose: mutation('Selection', {
          resolve: ({ store }) => {
            store.update('Selection', 'main', { todo: { id: 'new', title: 'New task' } });
            store.update('Todo', 'new', { title: 'Updated task' });
            return store.get('Selection', 'main');
          },
        }),
      }),
    );
    const Selection = view<EntityOf<typeof client, 'Selection'>>()({
      todo: { id: true, title: true },
    });
    const { selection: ref } = await client.request({ selection: { view: Selection } });
    const snapshots: Array<unknown> = [];
    client.store.subscribe('Selection:main', () => {
      const ref = client.store.read('Selection:main')?.todo;
      snapshots.push(isNodeRef(ref) ? client.store.read(getNodeRefId(ref))?.title : ref);
    });

    await client.mutations.choose();

    expect((await client.readView(Selection, ref)).data.todo).toMatchObject({
      id: 'new',
      title: 'Updated task',
    });
    expect(snapshots).toEqual(['Updated task']);
  },
);

test('remote relationship writes share the staged graph with local updates', async () => {
  type Person = { __typename: 'Person'; id: string; name: string };
  type Post = ServerPost & { author: Person };
  const roots = { post: clientRoot<Post, 'Post'>('Post') };
  const mutations = { save: mutation<Post, Record<never, never>, Post>('Post') };
  const saved: Post = {
    __typename: 'Post',
    author: { __typename: 'Person', id: 'a', name: 'Remote' },
    id: 'p',
    title: 'Saved',
  };
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    roots,
    transport: { fetchById: async () => [], mutate: (async () => saved) as any },
    types: [{ fields: { author: { type: 'Person' } }, type: 'Post' }, { type: 'Person' }],
  }).registerClientSchema(
    clientSchema({
      typeExtensions: {
        ...postSchema.typeExtensions,
        Person: {
          defaults: () => ({ note: '' }),
          view: dataView<{ note: string }>('Person')({ note: true }),
        },
      },
    }),
    ({ mutation }) => ({
      saveBoth: mutation('Post', {
        resolve: async ({ mutateRemote, store }) => {
          await mutateRemote('save', {});
          expect(store.get('Person', 'a')?.name).toBe('Remote');
          expect(client.store.read('Person:a')).toBeUndefined();
          store.update('Person', 'a', { note: 'Local' });
          expect(store.get('Post', 'p')?.author?.note).toBe('Local');
          return store.get('Post', 'p');
        },
      }),
    }),
  );
  await client.mutations.saveBoth();
  expect(client.store.read('Person:a')).toMatchObject({ name: 'Remote', note: 'Local' });
  const author = client.store.read('Post:p')?.author;
  expect(isNodeRef(author) && getNodeRefId(author)).toBe('Person:a');
});

test('mixed mutations stage concrete results of polymorphic remote mutations', async () => {
  const mutations = { save: mutation<{ __typename: 'Node' }, { id: string }, ServerPost>('Node') };
  const saved: ServerPost = { __typename: 'Post', id: 'p', title: 'Saved' };
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    roots,
    transport: { fetchById: async () => [], mutate: (async () => saved) as any },
    types: [{ possibleTypes: ['Post'], type: 'Node' }, { type: 'Post' }],
  }).registerClientSchema(postSchema, ({ mutation }) => ({
    saveBoth: mutation('Post', {
      resolve: async ({ mutateRemote, store }) => {
        await mutateRemote('save', { id: 'p' });
        expect(store.get('Post', 'p')?.title).toBe('Saved');
        return store.update('Post', 'p', { draft: 'Next draft' });
      },
    }),
  }));
  client.write('Post', { id: 'p', title: 'Before' }, new Set(['id', 'title']));

  await client.mutations.saveBoth();
  expect(client.store.read('Post:p')).toMatchObject({ draft: 'Next draft', title: 'Saved' });
  expect(client.store.read('Node:p')).toBeUndefined();
});

test('GraphQL refetches keep memo field arguments on the client', async () => {
  const schema = buildSchema(`
    type Post { id: ID!, title: String! }
    type Query { post(id: ID!): Post }
  `);
  const types = [
    { refetch: { args: { id: { field: 'id' } }, root: 'post' }, type: 'Post' },
  ] as const;
  const client = createClient({
    transport: createGraphQLTransport({
      fetch: async (_url, init) => {
        const { query, variables } = JSON.parse(init!.body as string);
        const response = await graphql({
          rootValue: { post: ({ id }: { id: string }) => ({ id, title: 'Hello' }) },
          schema,
          source: query,
          variableValues: variables,
        });
        return new Response(JSON.stringify(response));
      },
      nodes: false,
      roots: { post: { type: 'Post' } },
      schema: createGraphQLArgumentSchema(schema),
      types,
      url: '/graphql',
    }),
    types,
  }).registerClientSchema(postSchema);
  const Display = view<EntityOf<typeof client, 'Post'>>()({
    displayTitle: { args: { upper: true } },
  });
  client.write('Post', { id: 'p' }, new Set(['id']));

  expect((await client.readView(Display, client.ref('Post', 'p', Display))).data.displayTitle).toBe(
    'Hello',
  );
});

test.each(['query', 'refetch', 'persisted'] as const)(
  '%s selects parameterized memo dependencies without mixing argument variants',
  async (kind) => {
    type Post = { __typename: 'Post'; id: string; title: string };
    const schema = buildSchema(`
      type Post { id: ID!, title(locale: String): String! }
      type Query { post(id: ID!): Post }
    `);
    const types = [
      { refetch: { args: { id: { field: 'id' } }, root: 'post' }, type: 'Post' },
    ] as const;
    const fetch = vi.fn(async (_url, init) => {
      const { query, variables } = JSON.parse(init.body);
      return new Response(
        JSON.stringify(
          await graphql({
            rootValue: {
              post: ({ id }: { id: string }) => ({
                id,
                title: ({ locale }: { locale?: string }) => locale ?? 'default',
              }),
            },
            schema,
            source: query,
            variableValues: variables,
          }),
        ),
      );
    });
    const roots = { post: clientRoot<Post, 'Post'>('Post') };
    const storage = memoryStorage();
    const makeClient = () =>
      createClient<[typeof roots, Record<never, never>]>({
        persistence:
          kind === 'persisted'
            ? createPersistence({ key: 'parameterized-memo', storage })
            : undefined,
        roots,
        transport: createGraphQLTransport({
          fetch,
          nodes: false,
          roots: { post: { type: 'Post' } },
          schema: createGraphQLArgumentSchema(schema),
          types,
          url: '/graphql',
        }),
        types,
      }).registerClientSchema(
        clientSchema({
          typeExtensions: {
            Post: {
              defaults: () => ({}),
              view: dataView<Post>('Post')({
                decorated: memo({
                  resolve: (_post: Post & { label: string }, { label }) => `${label}!`,
                  select: { label: { args: (args) => args } },
                }),
                english: memo({
                  resolve: (_post: Post, { title }) => title,
                  select: { title: field('title', { args: { locale: 'en' } }) },
                }),
                label: memo({
                  resolve: (_post: Post, { title }) => `[${title}]`,
                  select: { title: { args: ({ locale }) => ({ locale }) } },
                }),
                original: memo({
                  resolve: (_post: Post, { title }) => title,
                  select: { title: true },
                }),
                translatedLabels: memo({
                  resolve: (_post: Post & { label: string }, { english, japanese }) =>
                    `${english}/${japanese}`,
                  select: {
                    english: field('label', { args: { locale: 'en' } }),
                    japanese: field('label', { args: { locale: 'ja' } }),
                  },
                }),
                translations: memo({
                  resolve: (_post: Post, { english, japanese, original }) =>
                    [english, japanese, original].join('/'),
                  select: {
                    english: field('title', { args: { locale: 'en' } }),
                    japanese: field('title', { args: { locale: 'ja' } }),
                    original: field('title'),
                  },
                }),
              }),
            },
          },
        }),
      );
    let client = makeClient();
    const PostView = view<EntityOf<typeof client, 'Post'>>()({
      decorated: { args: { locale: 'ja' } },
      english: true,
      fate_dependency_title: alias('title', { args: { locale: 'de' } }),
      japanese: alias('label', { args: { locale: 'ja' } }),
      original: true,
      spanish: alias('label', { args: { locale: 'es' } }),
      title: { args: { locale: 'fr' } },
      translatedLabels: true,
      translations: true,
    });
    try {
      client.write('Post', { id: 'p' }, new Set(['id']));
      let ref =
        kind === 'refetch'
          ? client.ref('Post', 'p', PostView)
          : (await client.request({ post: { args: { id: 'p' }, view: PostView } })).post;
      const expected = {
        decorated: '[ja]!',
        english: 'en',
        fate_dependency_title: 'de',
        japanese: '[ja]',
        original: 'default',
        spanish: '[es]',
        title: 'fr',
        translatedLabels: '[en]/[ja]',
        translations: 'en/ja/default',
      };
      expect((await client.readView(PostView, ref)).data).toMatchObject(expected);
      if (kind === 'persisted') {
        await client.persistence!.flush();
        client.persistence!.dispose();
        client = makeClient();
        ref = (await client.request({ post: { args: { id: 'p' }, view: PostView } })).post;
        expect((await client.readView(PostView, ref)).data).toMatchObject(expected);
      }
      expect(fetch).toHaveBeenCalledOnce();
      client.write('Post', { id: 'p', title: 'updated default' }, new Set(['id', 'title']));
      expect((await client.readView(PostView, ref)).data).toMatchObject({
        ...expected,
        original: 'updated default',
        translations: 'en/ja/updated default',
      });
      const titlePlan = getSelectionPlan(view<Post>()({ title: { args: { locale: 'ja' } } }), null);
      client.write(
        'Post',
        { id: 'p', title: 'updated Japanese' },
        new Set(['id', 'title']),
        titlePlan,
      );
      expect((await client.readView(PostView, ref)).data).toMatchObject({
        ...expected,
        decorated: '[updated Japanese]!',
        japanese: '[updated Japanese]',
        original: 'updated default',
        translatedLabels: '[en]/[updated Japanese]',
        translations: 'en/updated Japanese/updated default',
      });
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      client.persistence?.dispose();
    }
  },
);

test.each(['query', 'refetch', 'persisted'] as const)(
  '%s computes with default dependencies alongside parameterized fields',
  async (kind) => {
    const schema = buildSchema(`
      type Post { id: ID!, title(locale: String): String! }
      type Query { post(id: ID!): Post }
    `);
    const types = [
      { refetch: { args: { id: { field: 'id' } }, root: 'post' }, type: 'Post' },
    ] as const;
    const fetch = vi.fn(async (_url, init) => {
      const { query, variables } = JSON.parse(init.body);
      return new Response(
        JSON.stringify(
          await graphql({
            rootValue: {
              post: ({ id }: { id: string }) => ({
                id,
                title: ({ locale }: { locale?: string }) =>
                  locale === 'ja' ? 'こんにちは' : locale === 'en' ? 'English' : 'Hello',
              }),
            },
            schema,
            source: query,
            variableValues: variables,
          }),
        ),
      );
    });
    const storage = memoryStorage();
    const makeClient = () =>
      createClient<[typeof roots, Record<never, never>]>({
        persistence:
          kind === 'persisted' ? createPersistence({ key: 'memo-args', storage }) : undefined,
        roots,
        transport: createGraphQLTransport({
          fetch,
          nodes: false,
          roots: { post: { type: 'Post' } },
          schema: createGraphQLArgumentSchema(schema),
          types,
          url: '/graphql',
        }),
        types,
      }).registerClientSchema(postSchema);
    let client = makeClient();
    const Post = view<EntityOf<typeof client, 'Post'>>()({
      displayTitle: true,
      fate_dependency_title: alias('title', { args: { locale: 'en' } }),
      title: { args: { locale: 'ja' } },
    });
    try {
      client.write('Post', { id: 'p' }, new Set(['id']));
      let ref =
        kind === 'refetch'
          ? client.ref('Post', 'p', Post)
          : (await client.request({ post: { args: { id: 'p' }, view: Post } })).post;
      expect((await client.readView(Post, ref)).data).toEqual({
        __typename: 'Post',
        displayTitle: 'Hello',
        fate_dependency_title: 'English',
        title: 'こんにちは',
      });
      if (kind === 'persisted') {
        await client.persistence!.flush();
        client.persistence!.dispose();
        client = makeClient();
        ref = (await client.request({ post: { args: { id: 'p' }, view: Post } })).post;
        expect((await client.readView(Post, ref)).data).toMatchObject({
          displayTitle: 'Hello',
          title: 'こんにちは',
        });
      }
      expect(fetch).toHaveBeenCalledOnce();
      client.write('Post', { id: 'p', title: 'Updated' }, new Set(['id', 'title']));
      expect((await client.readView(Post, ref)).data).toMatchObject({
        displayTitle: 'Updated',
        title: 'こんにちは',
      });
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      client.persistence?.dispose();
    }
  },
);

test.each(['field', 'relationship'] as const)(
  'memo relationship dependencies keep their default %s arguments',
  async (kind) => {
    type Author = { __typename: 'Author'; id: string; name: string };
    type Post = { __typename: 'Post'; author: Author; id: string };
    const schema = buildSchema(`
      type Author { id: ID!, name(locale: String): String! }
      type Post { id: ID!, author(locale: String): Author! }
      type Query { post: Post! }
    `);
    const types = [{ fields: { author: { type: 'Author' } }, type: 'Post' }, { type: 'Author' }];
    const fetch = vi.fn(async (_url, init) => {
      const { query, variables } = JSON.parse(init.body);
      return new Response(
        JSON.stringify(
          await graphql({
            rootValue: {
              post: () => ({
                author: ({ locale = 'default' }: { locale?: string }) => ({
                  id: locale,
                  name: ({ locale: nameLocale }: { locale?: string }) => nameLocale ?? locale,
                }),
                id: 'p',
              }),
            },
            schema,
            source: query,
            variableValues: variables,
          }),
        ),
      );
    });
    const roots = { post: clientRoot<Post, 'Post'>('Post') };
    const client = createClient<[typeof roots, Record<never, never>]>({
      roots,
      transport: createGraphQLTransport({
        fetch,
        nodes: false,
        roots: { post: { type: 'Post' } },
        schema: createGraphQLArgumentSchema(schema),
        types,
        url: '/graphql',
      }),
      types,
    }).registerClientSchema(
      clientSchema({
        typeExtensions: {
          Author: {
            defaults: () => ({}),
            view: dataView<Author>('Author')({
              label: memo({
                resolve: (_author: Author, { name }) => name,
                select: { name: true },
              }),
              translated: memo({
                resolve: (_author: Author, { name }) => name,
                select: { name: { args: (args) => args } },
              }),
            }),
          },
          Post: {
            defaults: () => ({}),
            view: dataView<Post>('Post')({
              authorName: memo({
                resolve: (_post: Post, { name }) => name,
                select: { name: field('author.name') },
              }),
            }),
          },
        },
      }),
    );
    const PostView = view<EntityOf<typeof client, 'Post'>>()({
      author: {
        ...(kind === 'relationship' && { args: { locale: 'ja' } }),
        label: true,
        name: kind === 'field' ? { args: { locale: 'ja' } } : true,
        translated: { args: { locale: 'en' } },
      },
      authorName: true,
    });
    const { post } = await client.request({ post: { view: PostView } });
    expect((await client.readView(PostView, post)).data).toEqual({
      __typename: 'Post',
      author: {
        __typename: 'Author',
        id: kind === 'field' ? 'default' : 'ja',
        label: kind === 'field' ? 'default' : 'ja',
        name: 'ja',
        translated: 'en',
      },
      authorName: 'default',
    });
    expect(fetch).toHaveBeenCalledOnce();
  },
);

test('local relationships preserve numeric server identities when loading missing fields', async () => {
  type Person = { __typename: 'Person'; id: number; name: string };
  const person = dataView<Person>('Person')({ id: true, name: true });
  const selection = dataView<{ id: string; person: Person }>('Selection')({ id: true, person });
  const fetchById = vi.fn(async (_type: string, ids: Array<string | number>) => {
    expect(ids).toEqual([42]);
    return [{ id: 42, name: 'Ada' }];
  });
  const client = createClient({
    transport: { fetchById },
    types: [{ type: 'Person' }],
  }).registerClientSchema(
    clientSchema({
      roots: { selection: { id: 'main', type: 'Selection' } },
      types: { Selection: { defaults: (id) => ({ id, person: { id: 42 } }), view: selection } },
    }),
  );
  const Selection = view<EntityOf<typeof client, 'Selection'>>()({ person: { name: true } });
  const { selection: ref } = await client.request({ selection: { view: Selection } });
  expect((await client.readView(Selection, ref)).data.person.name).toBe('Ada');
  expect(fetchById).toHaveBeenCalledOnce();
});

test.each([false, true])(
  'remote calls scope selections to their own entity (separate args: %s)',
  async (separateMutationSelectionArgs) => {
    const mutate = vi.fn(
      async (
        _name: string,
        input: { args?: unknown; id: string },
        selection: Iterable<string>,
        args?: unknown,
      ) => {
        expect([...selection].every((field) => field === 'id' || field === 'title')).toBe(true);
        expect((separateMutationSelectionArgs ? args : input.args) ?? {}).not.toHaveProperty(
          'count',
        );
        return { __typename: 'Post' as const, id: input.id, title: 'Remote' };
      },
    );
    const mutations = { save: mutation<ServerPost, { id: string }, ServerPost>('Post') };
    const client = createClient<[Record<never, never>, typeof mutations]>({
      mutations,
      transport: {
        fetchById: async () => [],
        mutate: mutate as any,
        separateMutationSelectionArgs,
      },
      types: [{ type: 'Post' }],
    }).registerClientSchema(schema, ({ mutation }) => ({
      sync: mutation('UI', {
        resolve: async ({ mutateRemote, store }) => {
          await mutateRemote('save', { id: 'p' });
          return store.update('UI', 'main', { count: 1 });
        },
      }),
      syncSelected: mutation('UI', {
        resolve: async ({ mutateRemote, store }) => {
          await mutateRemote(
            'save',
            { id: 'p' },
            { select: { title: { args: { locale: 'en' } } } },
          );
          return store.update('UI', 'main', { count: 2 });
        },
      }),
      syncView: mutation('UI', {
        resolve: async ({ mutateRemote, store }) => {
          await mutateRemote(
            'save',
            { id: 'p' },
            {
              view: view<ServerPost>()({ title: { args: { locale: 'ja' } } }),
            },
          );
          return store.update('UI', 'main', { count: 3 });
        },
      }),
    }));
    const options = { args: { count: { format: 'hex' } }, view: UIView };
    await client.mutations.sync(options);
    await client.mutations.syncSelected(options);
    await client.mutations.syncView(options);
    expect(mutate.mock.calls.map((call) => [...call[2]])).toEqual([['id'], ['title'], ['title']]);
    expect(
      mutate.mock.calls.map((call) => (separateMutationSelectionArgs ? call[3] : call[1].args)),
    ).toEqual([undefined, { title: { locale: 'en' } }, { title: { locale: 'ja' } }]);
    expect(client.store.read('UI:main')?.count).toBe(3);
    expect(client.store.read('Post:p')?.title).toBe('Remote');
  },
);

test.each(['query', 'list'] as const)(
  '%s requests load client relationships without refetching query-only parents',
  async (kind) => {
    type Person = { __typename: 'Person'; id: string; name: string };
    const person = dataView<Person>('Person')({ id: true, name: true });
    const post = dataView<{ selected: Person }>('Post')({
      selected: person,
      selectedName: memo<{ selected: Person }, string>({
        resolve: (_item, { name }) => `Selected: ${name}`,
        select: { name: field('selected.name') },
      }),
    });
    const roots = {
      post: clientRoot<ServerPost, 'Post'>('Post'),
      posts: clientRoot<{ items: Array<{ node: ServerPost }> }, 'Post'>('Post'),
    };
    const fetchById = vi.fn(async (type: string, ids: Array<string | number>) => {
      if (type !== 'Person') {
        throw new Error('Post is available only through its query and list roots.');
      }
      return ids.map((id) => ({ id, name: id === 'a' ? 'Ada' : 'Bea' }));
    });
    const client = createClient<[typeof roots, Record<never, never>]>({
      roots,
      transport: {
        fetchById,
        fetchList: async () => ({
          items: [{ cursor: 'p', node: { id: 'p', title: 'Post' } }],
          pagination: { hasNext: false, hasPrevious: false },
        }),
        fetchQuery: async () => ({ id: 'p', title: 'Post' }),
      },
      types: [{ type: 'Post' }, { type: 'Person' }],
    }).registerClientSchema(
      clientSchema({
        typeExtensions: { Post: { defaults: () => ({ selected: { id: 'a' } }), view: post } },
      }),
      ({ mutation }) => ({
        choose: mutation('Post', {
          resolve: ({ store }) => store.update('Post', 'p', { selected: { id: 'b' } }),
        }),
      }),
    );
    const PostView = view<EntityOf<typeof client, 'Post'>>()({
      selectedName: true,
      title: true,
    });
    const ref =
      kind === 'query'
        ? (await client.request({ post: { view: PostView } })).post
        : (await client.request({ posts: { list: PostView } })).posts[0];
    expect((await client.readView(PostView, ref)).data).toMatchObject({
      selectedName: 'Selected: Ada',
      title: 'Post',
    });
    expect(fetchById).toHaveBeenCalledExactlyOnceWith(
      'Person',
      ['a'],
      new Set(['name']),
      undefined,
    );
    await client.mutations.choose();
    expect((await client.readView(PostView, ref)).data.selectedName).toBe('Selected: Bea');
    expect(fetchById).toHaveBeenLastCalledWith('Person', ['b'], new Set(['name']), undefined);
  },
);

const translatedPost = (locale: string) => ({
  author: { name: { args: { locale } } },
  translatedTitle: alias('title', { args: { locale } }),
});

test.each([false, true])(
  'mutation input arguments respect transport mode (separate: %s)',
  async (separateMutationSelectionArgs) => {
    type Input = { args: { displayTitle: { upper: boolean } }; id: string };
    const mutations = { save: mutation<ServerPost, Input, ServerPost>('Post') };
    const saved: ServerPost = { __typename: 'Post', id: 'p', title: 'Saved' };
    const mutate = vi.fn(async (_name: 'save', _input: Input) => saved);
    const client = createClient<[typeof roots, typeof mutations]>({
      mutations,
      roots,
      transport: {
        fetchById: async () => [],
        mutate: mutate as any,
        separateMutationSelectionArgs,
      },
      types: [{ type: 'Post' }],
    }).registerClientSchema(postSchema);
    const Display = view<EntityOf<typeof client, 'Post'>>()({
      displayTitle: { args: { upper: true } },
    });
    const input = { args: { displayTitle: { upper: true } }, id: 'p' };

    await client.mutations.save({ input, view: Display });
    expect(mutate.mock.calls[0][1]).toEqual(separateMutationSelectionArgs ? input : { id: 'p' });
  },
);

test.each(['inherit', 'view', 'select'] as const)(
  'mixed mutations preserve field arguments from the %s selection',
  async (selection) => {
    type Person = { __typename: 'Person'; id: string; name: string };
    type Post = ServerPost & { author: Person };
    const mutations = { save: mutation<Post, { id: string }, Post>('Post') };
    const French = view<Post>()(translatedPost('fr'));
    const Japanese = view<Post>()(translatedPost('ja'));
    const Original = view<Post>()({ author: { name: true }, title: true });
    const fetchById = vi.fn(async () => {
      throw new Error('The mutation response should already cover this view.');
    });
    const client = createClient<[Record<never, never>, typeof mutations]>({
      mutations,
      transport: {
        fetchById,
        mutate: (async (_name: string, input: { args: { title: { locale: string } } }) => {
          const { locale } = input.args.title;
          return {
            author: { id: 'a', name: `Author ${locale}` },
            id: 'p',
            title: `Title ${locale}`,
          };
        }) as any,
      },
      types: [{ fields: { author: { type: 'Person' } }, type: 'Post' }, { type: 'Person' }],
    }).registerClientSchema(postSchema, ({ mutation }) => ({
      saveTranslations: mutation('Post', {
        resolve: async ({ mutateRemote, store }) => {
          await mutateRemote(
            'save',
            { id: 'p' },
            selection === 'inherit'
              ? undefined
              : selection === 'view'
                ? { view: French }
                : { select: translatedPost('fr') },
          );
          await mutateRemote('save', { id: 'p' }, { view: Japanese });
          expect(store.get('Post', 'p')?.title).toBe('Original title');
          return store.update('Post', 'p', { draft: 'Local draft' });
        },
      }),
    }));
    client.write(
      'Post',
      { author: { id: 'a', name: 'Original author' }, id: 'p', title: 'Original title' },
      new Set(['author.name', 'id', 'title']),
    );
    const ActionView = view<EntityOf<typeof client, 'Post'>>()(translatedPost('fr'));
    await client.mutations.saveTranslations({ view: ActionView });
    expect((await client.readView(Original, client.ref('Post', 'p', Original))).data).toMatchObject(
      {
        author: { name: 'Original author' },
        title: 'Original title',
      },
    );
    for (const [locale, selected] of [
      ['fr', French],
      ['ja', Japanese],
    ] as const) {
      expect(
        (await client.readView(selected, client.ref('Post', 'p', selected))).data,
      ).toMatchObject({
        author: { name: `Author ${locale}` },
        translatedTitle: `Title ${locale}`,
      });
    }
    expect(client.store.read('Post:p')?.draft).toBe('Local draft');
    expect(fetchById).not.toHaveBeenCalled();
  },
);

test.each(['partial', 'unselected', 'complete'] as const)(
  'mixed mutations merge a %s remote connection without losing loaded pages',
  async (response) => {
    type Comment = { __typename: 'Comment'; body: string; id: string };
    type Post = ServerPost & { comments: Array<Comment> };
    const mutations = { save: mutation<Post, { id: string }, Post>('Post') };
    const client = createClient<[Record<never, never>, typeof mutations]>({
      mutations,
      transport: {
        fetchById: async () => [],
        mutate: (async () => ({
          comments: {
            items: [{ cursor: 'c1', node: { body: 'Updated', id: 'c1' } }],
            pagination: { hasNext: response === 'partial', hasPrevious: false },
          },
          id: 'p',
          title: 'Saved',
        })) as any,
      },
      types: [{ fields: { comments: { listOf: 'Comment' } }, type: 'Post' }, { type: 'Comment' }],
    }).registerClientSchema(postSchema, ({ mutation }) => ({
      savePost: mutation('Post', {
        resolve: async ({ mutateRemote, store }) => {
          await mutateRemote('save', { id: 'p' });
          expect(store.get('Post', 'p')?.comments?.map(({ body }) => body)).toContain('Updated');
          return store.update('Post', 'p', { expanded: true });
        },
      }),
    }));
    client.write(
      'Post',
      {
        comments: [
          { body: 'One', id: 'c1' },
          { body: 'Two', id: 'c2' },
        ],
        id: 'p',
      },
      new Set(['comments.body', 'comments.id', 'id']),
    );
    await client.mutations.savePost({
      select: response === 'unselected' ? { title: true } : { comments: { body: true, id: true } },
    });
    expect(client.store.getListsForField('Post:p', 'comments')[0][1].ids).toEqual(
      response === 'complete' ? ['Comment:c1'] : ['Comment:c1', 'Comment:c2'],
    );
    expect(client.store.read('Comment:c1')?.body).toBe('Updated');
    expect(client.store.read('Post:p')?.expanded).toBe(true);
  },
);

test.each([false, true])(
  'hydration keeps local list membership consistent with its owner (edited: %s)',
  async (edited) => {
    type Person = { __typename: 'Person'; id: string; name: string };
    const person = dataView<Person>('Person')({ id: true, name: true });
    const selection = dataView<{ id: string; people: Array<Person> }>('Selection')({
      id: true,
      people: list(person),
    });
    const schema = clientSchema({
      roots: { selection: { id: 'main', type: 'Selection' } },
      types: { Selection: { defaults: (id) => ({ id, people: [] }), view: selection } },
    });
    const fetchById = vi.fn(async (_type: string, ids: Array<string | number>) =>
      ids.map((id) => ({ id, name: `Person ${id}` })),
    );
    const make = () =>
      createClient({ transport: { fetchById }, types: [{ type: 'Person' }] }).registerClientSchema(
        schema,
        ({ mutation }) => ({
          choose: mutation('Selection', {
            input: z.object({ id: z.string() }),
            resolve: ({ input, store }) =>
              store.update('Selection', 'main', { people: [{ id: input.id }] }),
          }),
        }),
      );
    const server = make();
    await server.mutations.choose({ input: { id: 'a' } });
    const client = make();
    if (edited) {
      await client.mutations.choose({ input: { id: 'b' } });
    }
    client.hydrate(server.dehydrate());
    const id = edited ? 'b' : 'a';
    const Selected = view<EntityOf<typeof client, 'Selection'>>()({ people: { name: true } });
    const { selection: ref } = await client.request({ selection: { view: Selected } });
    expect((await client.readView(Selected, ref)).data.people).toEqual([
      { __typename: 'Person', id, name: `Person ${id}` },
    ]);
    expect(client.store.getListsForField('Selection:main', 'people')[0][1].ids).toEqual([
      `Person:${id}`,
    ]);
    expect(fetchById).toHaveBeenCalledExactlyOnceWith('Person', [id], new Set(['name']), undefined);
  },
);

test.each(['remote', 'client'] as const)(
  '%s mutation invalidation refreshes server fields without leaving client fields stale',
  async (kind) => {
    const { client, fetch } = makeRemote();
    const request = { post: { id: 'p', view: PostView } };
    const { post } = await client.request(request);
    if (kind === 'remote') {
      await client.mutations.post.save({ input: { id: 'p', title: 'Saved' }, invalidate: [post] });
    } else {
      await client.mutations.post.edit({ input: { draft: 'Draft', id: 'p' }, invalidate: [post] });
    }
    expect(client.store.hasStalePath('Post:p', 'title')).toBe(true);
    await client.request(request);
    await client.request(request);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const field of ['draft', 'expanded', 'title']) {
      expect(client.store.hasStalePath('Post:p', field)).toBeFalsy();
    }
    expect((await client.readView(PostView, post)).data).toMatchObject({
      draft: kind === 'client' ? 'Draft' : null,
      expanded: false,
    });
  },
);

test('invalidation leaves authoritative client roots and lists fresh', async () => {
  const client = makeClient();
  await client.mutations.todo.add({ input: { id: 'a', title: 'Local task' } });
  const request = { ui: { view: UIView } };
  const { ui } = await client.request(request);
  const { data } = await client.readView(UIView, ui);
  await client.mutations.ui.increment({ input: { amount: 1 }, invalidate: [ui, data.todos] });
  expect(client.store.hasStaleRecord('UI:main')).toBe(false);
  expect(client.store.getListsForField('UI:main', 'todos')[0][1].stale).toBeUndefined();
  await client.request(request);
  expect((await client.readView(UIView, ui)).data).toMatchObject({
    count: 1,
    todos: [{ title: 'Local task' }],
  });
});

test('mutation reads copy Date values and preserve them in nested patches', async () => {
  const timestamp = new Date('2026-01-01T00:00:00Z');
  const clock = dataView<{ history: Array<{ at: Date }>; id: string; timestamp: Date }>('Clock')({
    history: true,
    id: true,
    nextTimestamp: memo({
      resolve: () => new Date(timestamp.getTime() + 1),
    }),
    timestamp: true,
  });
  const client = createClient().registerClientSchema(
    clientSchema({
      roots: { clock: { id: 'main', type: 'Clock' } },
      types: {
        Clock: {
          defaults: (id) => ({ history: [{ at: timestamp }], id, timestamp }),
          view: clock,
        },
      },
    }),
    ({ mutation }) => ({
      copy: mutation('Clock', {
        resolve: ({ store }) => {
          const snapshot = store.get('Clock', 'main')!;
          expectTypeOf(snapshot.timestamp).toEqualTypeOf<Date | undefined>();
          expectTypeOf(snapshot.history).toEqualTypeOf<Array<{ at: Date }> | undefined>();
          expect(snapshot.timestamp).toEqual(timestamp);
          expect(snapshot.timestamp).not.toBe(timestamp);
          expect(snapshot.history).toEqual([{ at: timestamp }]);
          expect(snapshot.history![0].at).not.toBe(timestamp);
          return store.update('Clock', 'main', { history: snapshot.history });
        },
      }),
    }),
  );
  const { result } = await client.mutations.copy();
  expect(result).toMatchObject({ history: [{ at: timestamp }], timestamp });
  expect(client.store.read('Clock:main')).toMatchObject({
    history: [{ at: timestamp }],
    timestamp,
  });
  const ClockView = view<EntityOf<typeof client, 'Clock'>>()({
    history: true,
    nextTimestamp: true,
    timestamp: true,
  });
  const { clock: ref } = await client.request({ clock: { view: ClockView } });
  const { data } = await client.readView(ClockView, ref);
  expectTypeOf(data.timestamp).toEqualTypeOf<Date>();
  expectTypeOf(data.history).toEqualTypeOf<Array<{ at: Date }>>();
  expectTypeOf(data.nextTimestamp).toEqualTypeOf<Date>();
  expect(data.timestamp.getTime()).toBe(timestamp.getTime());
  expect(data.history[0].at.getTime()).toBe(timestamp.getTime());
  expect(data.nextTimestamp.getTime()).toBe(timestamp.getTime() + 1);
  expectTypeOf<DataViewResult<typeof clock>['timestamp']>().toEqualTypeOf<string>();
  expectTypeOf<DataViewResult<typeof clock>['nextTimestamp']>().toEqualTypeOf<string>();
});

test('live connection events preserve client fields on existing nodes', async () => {
  const roots = { posts: clientRoot<ServerPost, 'Post'>('Post') };
  let onEvent!: (event: FateLiveConnectionEvent) => void;
  const client = createClient({
    roots,
    transport: {
      fetchById: async () => [],
      fetchList: async () => ({
        items: [{ cursor: 'p', node: { id: 'p', title: 'Before' } }],
        pagination: { hasNext: false, hasPrevious: false },
      }),
      subscribeConnection: (_procedure, _type, _args, _select, _selectionArgs, handlers) => {
        onEvent = handlers.onEvent;
        return () => {};
      },
    },
    types: [{ type: 'Post' }],
  }).registerClientSchema(postSchema, ({ mutation }) => ({
    edit: mutation('Post', {
      resolve: ({ store }) => store.update('Post', 'p', { draft: 'Keep my draft' }),
    }),
  }));
  const { posts } = await client.request({
    posts: { list: { items: { node: PostView }, pagination: { hasNext: true } } },
  });
  const metadata = (posts as unknown as { [ConnectionTag]: ConnectionMetadata })[ConnectionTag];
  await client.mutations.edit();
  const dispose = client.subscribeLiveListView(PostView, metadata);
  try {
    for (const node of [
      { id: 'p', title: 'Updated' },
      { draft: 'Untrusted server draft', id: 'p', title: 'Updated again' },
    ]) {
      onEvent({ edge: { cursor: 'p', node }, nodeType: 'Post', type: 'appendEdge' });
      expect(client.store.read('Post:p')).toMatchObject({
        draft: 'Keep my draft',
        title: node.title,
      });
    }
  } finally {
    dispose();
  }
});

const relationshipPage = (after?: unknown) => {
  const id = after ? 'p2' : 'p1';
  return {
    items: [{ cursor: id, node: { id, title: `Post ${id}` } }],
    pagination: { hasNext: !after, hasPrevious: !!after, nextCursor: id },
  };
};

test.each([false, true])(
  'views load client relationships on new connection pages (root: %s)',
  async (root) => {
    type Group = { __typename: 'Group'; id: string; posts: Array<ServerPost> };
    type Person = { __typename: 'Person'; id: string; name: string };
    const roots = {
      group: clientRoot<Group, 'Group'>('Group'),
      posts: clientRoot<ServerPost, 'Post'>('Post'),
    };
    const fetchById = vi.fn(async (type: string, ids: Array<string | number>, args?: any) => {
      if (type === 'Group') {
        return [{ id: 'g', posts: relationshipPage(args?.posts?.after) }];
      }
      if (type === 'Person') {
        return ids.map((id) => ({ id, name: `Person ${id}` }));
      }
      throw new Error('Posts are only available through their list.');
    });
    const client = createClient<[typeof roots, Record<never, never>]>({
      roots,
      transport: {
        fetchById: (type, ids, _select, args) => fetchById(type, ids, args),
        fetchList: async (_name, _select, args) => relationshipPage(args?.after),
      },
      types: [
        { fields: { posts: { listOf: 'Post' } }, type: 'Group' },
        { type: 'Post' },
        { type: 'Person' },
      ],
    }).registerClientSchema(
      clientSchema({
        typeExtensions: {
          Post: {
            defaults: (id) => ({ selected: { id: `person-${id}` } }),
            view: dataView<{ selected: Person }>('Post')({
              selected: dataView<Person>('Person')({ id: true, name: true }),
            }),
          },
        },
      }),
    );
    const PagePost = view<EntityOf<typeof client, 'Post'>>()({
      selected: { name: true },
      title: true,
    });
    const selection = {
      items: { node: PagePost },
      pagination: { hasNext: true, nextCursor: true },
    } as const;
    const GroupView = view<EntityOf<typeof client, 'Group'>>()({ posts: selection });
    const connection = root
      ? (await client.request({ posts: { list: selection } })).posts
      : (
          await client.readView(
            GroupView,
            (await client.request({ group: { id: 'g', view: GroupView } })).group,
          )
        ).data.posts;
    const metadata = (connection as unknown as { [ConnectionTag]: ConnectionMetadata })[
      ConnectionTag
    ];

    await client.loadConnection(PagePost, metadata, { after: 'p1' });
    const { data } = await client.readView(PagePost, client.ref('Post', 'p2', PagePost));
    expect(data.selected.name).toBe('Person person-p2');
  },
);

test.each([false, true])(
  'connection refreshes and pages preserve client fields (root: %s)',
  async (root) => {
    type Group = { __typename: 'Group'; id: string; posts: Array<ServerPost> };
    const roots = {
      group: clientRoot<Group, 'Group'>('Group'),
      posts: clientRoot<ServerPost, 'Post'>('Post'),
    };
    let injectClientFields = false;
    const page = () => ({
      items: ['p', 'next'].map((id) => ({
        cursor: id,
        node: {
          id,
          title: 'Server title',
          ...(injectClientFields ? { draft: 'Server draft', expanded: true } : {}),
        },
      })),
      pagination: { hasNext: true, hasPrevious: false, nextCursor: 'next' },
    });
    const fetchList = vi.fn(async (_name: string, _select: Iterable<string>, args?: object) => {
      expect(args ?? {}).not.toHaveProperty('displayTitle');
      return page();
    });
    const fetchById = vi.fn(async () => [{ id: 'g', posts: page() }]);
    const client = createClient<[typeof roots, Record<never, never>]>({
      roots,
      transport: { fetchById, fetchList },
      types: [{ fields: { posts: { listOf: 'Post' } }, type: 'Group' }, { type: 'Post' }],
    }).registerClientSchema(postSchema, ({ mutation }) => ({
      edit: mutation('Post', {
        resolve: ({ store }) => store.update('Post', 'p', { draft: 'Keep my draft' }),
      }),
    }));
    const PagePostView = view<Post>()({
      displayTitle: { args: { upper: true } },
      draft: true,
      expanded: true,
      id: true,
    });
    const selection = {
      items: { node: PagePostView },
      pagination: { hasNext: true, nextCursor: true },
    } as const;
    const GroupView = view<EntityOf<typeof client, 'Group'>>()({ posts: selection });
    if (!root) {
      await client.request({ group: { id: 'g', view: GroupView } });
    }
    const connection = root
      ? (await client.request({ posts: { list: selection } })).posts
      : (await client.readView(GroupView, client.ref('Group', 'g', GroupView))).data.posts;
    const metadata = (connection as unknown as { [ConnectionTag]: ConnectionMetadata })[
      ConnectionTag
    ];
    const ref = client.ref('Post', 'p', PostView);
    await client.mutations.edit();

    await client.loadConnection(PagePostView, metadata, {});
    expect((await client.readView(PostView, ref)).data).toMatchObject({
      displayTitle: 'Keep my draft',
      draft: 'Keep my draft',
      expanded: false,
    });

    injectClientFields = true;
    await client.loadConnection(PagePostView, metadata, { after: 'next' });
    if (root) {
      expect(fetchList.mock.calls.at(-1)?.[2]).toEqual({ after: 'next' });
    }
    expect((await client.readView(PostView, ref)).data).toMatchObject({
      displayTitle: 'Keep my draft',
      draft: 'Keep my draft',
      expanded: false,
    });
    expect(client.store.read('Post:next')).toMatchObject({ draft: null, expanded: false });
  },
);
