import { clientRoot, createClient, view } from '@nkzw/fate';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { connectFateDevtools } from '../index.ts';
import {
  channelName,
  isAppMessage,
  type AppMessage,
  type ClientSnapshot,
  type DevtoolsAction,
} from '../protocol.ts';
import { toJSONValue } from '../serialize.ts';

type Post = { __typename: 'Post'; author: User; id: string; title: string };
type User = { __typename: 'User'; id: string; name: string };

const PostView = view<Post>()({
  author: { id: true, name: true },
  id: true,
  title: true,
});

const cleanup: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanup.splice(0)) {
    fn();
  }
});

const createPostClient = () => {
  const transport = {
    fetchById: vi.fn(async (_type: string, ids: Array<string | number>) =>
      ids.map((id) => ({
        __typename: 'Post',
        author: { __typename: 'User', id: 'user-1', name: 'Kiwi' },
        id,
        title: `Post ${id}`,
      })),
    ),
    mutate: vi.fn(async () => {
      throw new Error('Nope.');
    }),
  };
  const client = createClient({
    roots: { post: clientRoot('Post') },
    transport,
    types: [{ fields: { author: { type: 'User' } }, type: 'Post' }, { type: 'User' }],
  });
  return { client, transport };
};

/** A fake panel on the other end of the channel. */
const createPanel = () => {
  const channel = new BroadcastChannel(channelName);
  const messages: Array<AppMessage> = [];
  const waiters = new Set<() => void>();
  channel.addEventListener('message', (event) => {
    if (isAppMessage(event.data)) {
      messages.push(event.data);
      for (const waiter of waiters) {
        waiter();
      }
    }
  });
  cleanup.push(() => channel.close());

  const next = <T extends AppMessage['type']>(
    type: T,
    predicate: (message: Extract<AppMessage, { type: T }>) => boolean = () => true,
  ) =>
    new Promise<Extract<AppMessage, { type: T }>>((resolve) => {
      const check = () => {
        const match = messages.find(
          (message): message is Extract<AppMessage, { type: T }> =>
            message.type === type && predicate(message as Extract<AppMessage, { type: T }>),
        );
        if (match) {
          messages.splice(messages.indexOf(match), 1);
          waiters.delete(check);
          resolve(match);
        }
      };
      waiters.add(check);
      check();
    });

  return {
    action: (clientId: string, action: DevtoolsAction) =>
      channel.postMessage({ action, clientId, source: 'fate-devtools:panel', type: 'action' }),
    discover: () => channel.postMessage({ source: 'fate-devtools:panel', type: 'discover' }),
    next,
    snapshot: (predicate: (snapshot: ClientSnapshot) => boolean = () => true) =>
      next('snapshot', ({ snapshot }) => predicate(snapshot)).then(({ snapshot }) => snapshot),
    watch: (clientId: string) =>
      channel.postMessage({
        clientId,
        panelId: 'test-panel',
        source: 'fate-devtools:panel',
        type: 'watch',
      }),
  };
};

const connect = async (client: ReturnType<typeof createPostClient>['client']) => {
  const panel = createPanel();
  const disconnect = connectFateDevtools(client, { name: 'test' });
  cleanup.push(disconnect);
  const { client: summary } = await panel.next('connected', ({ client }) => client.name === 'test');
  panel.watch(summary.id);
  return { disconnect, id: summary.id, panel };
};

test(`'connectFateDevtools' answers discovery and sends snapshots to watching panels`, async () => {
  const { client } = createPostClient();
  const { id, panel } = await connect(client);

  const initial = await panel.snapshot();
  expect(initial).toMatchObject({ id, name: 'test', records: [], roots: ['post'] });

  panel.discover();
  expect((await panel.next('connected')).client.id).toBe(id);
});

test(`'connectFateDevtools' records network operations and the cache they produce`, async () => {
  const { client, transport } = createPostClient();
  const { panel } = await connect(client);
  await panel.snapshot();

  await client.request({ post: { id: '1', view: PostView } });
  const snapshot = await panel.snapshot(({ operations }) =>
    operations.some(({ status }) => status === 'success'),
  );

  expect(transport.fetchById).toHaveBeenCalledTimes(1);
  expect(snapshot.operations).toEqual([
    expect.objectContaining({
      input: { ids: ['1'] },
      kind: 'fetchById',
      name: 'Post',
      select: ['author.id', 'author.name', 'id', 'title'],
      status: 'success',
    }),
  ]);

  const post = snapshot.records.find(({ id }) => id === 'Post:1');
  expect(post).toMatchObject({
    optimistic: false,
    rawId: '1',
    record: { author: { $ref: 'User:user-1' }, id: '1', title: 'Post 1' },
    stale: [],
    type: 'Post',
  });
  expect(post?.coverage).toEqual(['author.id', 'author.name', 'id', 'title']);
  expect(snapshot.records.map(({ id }) => id)).toContain('User:user-1');
  expect(snapshot.changes.map(({ key }) => key)).toEqual(
    expect.arrayContaining(['Post:1', 'User:user-1']),
  );
});

test(`'connectFateDevtools' captures failed operations`, async () => {
  const { client } = createPostClient();
  const { panel } = await connect(client);
  await panel.snapshot();

  const transport = (
    client as unknown as { transport: { mutate: (...args: Array<unknown>) => Promise<unknown> } }
  ).transport;
  await expect(transport.mutate('post.like', { id: '1' }, new Set(['id']))).rejects.toThrow(
    'Nope.',
  );

  const snapshot = await panel.snapshot(({ operations }) =>
    operations.some(({ status }) => status === 'error'),
  );
  expect(snapshot.operations).toEqual([
    expect.objectContaining({
      error: 'Nope.',
      input: { id: '1' },
      kind: 'mutate',
      name: 'post.like',
      status: 'error',
    }),
  ]);
});

test(`'connectFateDevtools' runs panel actions against the client`, async () => {
  const { client } = createPostClient();
  const { id, panel } = await connect(client);
  await panel.snapshot();
  await client.request({ post: { id: '1', view: PostView } });
  await panel.snapshot(({ records }) => records.length > 0);

  panel.action(id, { id: 'Post:1', type: 'invalidate-record' });
  const invalidated = await panel.snapshot(({ records }) =>
    records.some(({ id, stale }) => id === 'Post:1' && stale.length > 0),
  );
  expect(invalidated.changes.at(-1)).toMatchObject({ invalidated: true, key: 'Post:1' });

  panel.action(id, { id: 'Post:1', type: 'delete-record' });
  const deleted = await panel.snapshot(({ records }) => !records.some(({ id }) => id === 'Post:1'));
  expect(deleted.records.map(({ id }) => id)).toEqual(['User:user-1']);

  panel.action(id, { type: 'clear-log' });
  const cleared = await panel.snapshot(({ changes }) => changes.length === 0);
  expect(cleared.operations).toEqual([]);
});

test(`'connectFateDevtools' restores the client when the last connection is disposed`, async () => {
  const { client } = createPostClient();
  const internals = client as unknown as {
    store: object;
    transport: object;
  };
  const transport = internals.transport;
  const hadOnChange = Object.hasOwn(internals.store, 'onChange');

  const first = connectFateDevtools(client);
  const second = connectFateDevtools(client);
  const instrumented = internals.transport;
  expect(instrumented).not.toBe(transport);

  first();
  first();
  expect(internals.transport).toBe(instrumented);

  second();
  expect(internals.transport).toBe(transport);
  expect(Object.hasOwn(internals.store, 'onChange')).toBe(hadOnChange);
});

function load() {}

test(`'toJSONValue' turns fate values into plain JSON`, () => {
  const ref = Object.freeze(
    Object.defineProperty({}, Symbol('__fate__node-ref'), { value: 'User:1' }),
  );
  const cycle: Record<string, unknown> = { name: 'cycle' };
  cycle.self = cycle;

  expect(
    toJSONValue({
      bigint: BigInt(1),
      cycle,
      date: new Date(0),
      fn: load,
      map: new Map([['a', 1]]),
      ref,
      set: new Set([1, 2]),
      undefined,
    }),
  ).toEqual({
    bigint: '1n',
    cycle: { name: 'cycle', self: '[Circular]' },
    date: '1970-01-01T00:00:00.000Z',
    fn: 'ƒ load()',
    map: { a: 1 },
    ref: { $ref: 'User:1' },
    set: [1, 2],
    undefined: null,
  });
});
