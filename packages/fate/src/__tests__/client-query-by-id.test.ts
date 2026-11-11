import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import {
  clientQuery,
  clientSchema,
  createClient,
  dataView,
  view,
  type ClientDefinitionOf,
  type EntityOf,
} from '../index.ts';

test.each(['task', 0, 42])(
  'by-ID roots react to creation, updates and deletion for ID %s',
  async (id) => {
    const fetchById = vi.fn();
    const client = createClient({ transport: { fetchById } }).registerClientSchema(
      clientSchema({
        roots: { task: clientQuery.byId('Task') },
        types: {
          Task: {
            defaults: (id) => ({ id, title: 'Initial' }),
            view: dataView<{ id: string | number; title: string }>('Task')({
              id: true,
              title: true,
            }),
          },
        },
      }),
      ({ mutation }) => ({
        create: mutation('Task', { resolve: ({ store }) => store.create('Task', { id }) }),
        delete: mutation('Task', { resolve: ({ store }) => store.delete('Task', id) }),
        rename: mutation('Task', {
          resolve: ({ store }) => store.update('Task', id, { title: 'Edited' }),
        }),
      }),
    );
    const Task = view<EntityOf<typeof client, 'Task'>>()({ id: true, title: true });
    type Root = ClientDefinitionOf<typeof client>['roots']['task'];
    expectTypeOf<Root['type']>().toEqualTypeOf<'Task'>();
    const request = { task: { args: { id }, view: Task } };
    expect(await client.request(request)).toEqual({ task: null });
    const observer = client.observeRequestResult(request);
    const changed = vi.fn();
    const unsubscribe = observer.subscribe(changed);
    try {
      await client.mutations.create();
      const { task } = observer.getSnapshot();
      expectTypeOf(task?.__typename).toEqualTypeOf<'Task' | undefined>();
      expect((await client.readView(Task, task!)).data).toMatchObject({ id, title: 'Initial' });
      await client.mutations.rename();
      expect((await client.readView(Task, task!)).data.title).toBe('Edited');
      await client.mutations.delete();
      expect(observer.getSnapshot()).toEqual({ task: null });
      expect(changed).toHaveBeenCalled();
      expect(fetchById).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  },
);

test.each([
  undefined,
  null,
  {},
  { id: null },
  { id: true },
  { id: [] },
  { id: Number.NaN },
  { id: Infinity },
])('by-ID roots reject invalid arguments %j', (args) => {
  const query = clientQuery.byId('Task');
  expect(() => query.args!.parse(args)).toThrow('id');
});

test('by-ID roots preserve valid string and numeric IDs without coercion', () => {
  const query = clientQuery.byId('Task');
  expectTypeOf(query.type).toEqualTypeOf<'Task'>();
  expectTypeOf(query.args!.parse({ id: 'task' })).toEqualTypeOf<{ id: string | number }>();
  expect(query.args!.parse({ extra: 'ignored', id: '0' })).toEqual({ id: '0' });
  expect(query.args!.parse({ id: 0 })).toEqual({ id: 0 });
  expect(query.args!.parse({ id: '' })).toEqual({ id: '' });
});
