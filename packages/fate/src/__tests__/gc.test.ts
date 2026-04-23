import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { FateMutations } from '../mutation.ts';
import { toEntityId } from '../ref.ts';
import { clientRoot } from '../root.ts';
import { AnyRecord, ConnectionMetadata, ConnectionTag, FateRoots, Request } from '../types.ts';
import { view } from '../view.ts';

type GCClient = ReturnType<typeof createClient<[FateRoots, FateMutations]>> & {
  gc(): void;
  retain(request: Request): { dispose(): void };
};

const createGCClient = (
  options: Parameters<typeof createClient>[0] & { gcReleaseBufferSize: number },
) => createClient(options as Parameters<typeof createClient>[0]) as GCClient;

const flushGarbageCollection = () => Promise.resolve();

test(`'gc' collects unretained root list records and list state`, async () => {
  type Post = { __typename: 'Post'; id: string; title: string };

  const fetchList = vi.fn(async (_name, _select, args) => ({
    items: [
      {
        cursor: undefined,
        node: {
          __typename: 'Post',
          id: `post-${String(args?.tag)}`,
          title: String(args?.tag),
        },
      },
    ],
    pagination: { hasNext: false, hasPrevious: false },
  }));

  const client = createGCClient({
    gcReleaseBufferSize: 0,
    roots: { posts: clientRoot('Post') },
    transport: {
      async fetchById() {
        return [];
      },
      fetchList,
    },
    types: [{ fields: { title: 'scalar' }, type: 'Post' }],
  });

  const PostView = view<Post>()({ id: true, title: true });
  const PostConnectionView = { items: { node: PostView } };
  const request = { posts: { args: { tag: 'A' }, list: PostConnectionView } };
  const retained = client.retain(request);
  const { posts } = await client.request(request);
  const metadata = (posts as unknown as AnyRecord)[ConnectionTag as any] as ConnectionMetadata;

  expect(client.store.read(toEntityId('Post', 'post-A'))).toMatchObject({ title: 'A' });
  expect(client.store.getListState(metadata.key)?.ids).toEqual([toEntityId('Post', 'post-A')]);

  retained.dispose();
  await flushGarbageCollection();

  expect(client.store.read(toEntityId('Post', 'post-A'))).toBeUndefined();
  expect(client.store.getListState(metadata.key)).toBeUndefined();
});

test(`'gc' keeps records reachable from retained selections`, async () => {
  type User = { __typename: 'User'; id: string; name: string };
  type Post = { __typename: 'Post'; author: User; id: string; title: string };

  const fetchList = vi.fn(async () => ({
    items: [
      {
        cursor: undefined,
        node: {
          __typename: 'Post',
          author: { __typename: 'User', id: 'user-1', name: 'Kiwi' },
          id: 'post-1',
          title: 'Retained',
        },
      },
    ],
    pagination: { hasNext: false, hasPrevious: false },
  }));

  const client = createGCClient({
    gcReleaseBufferSize: 0,
    roots: { posts: clientRoot('Post') },
    transport: {
      async fetchById() {
        return [];
      },
      fetchList,
    },
    types: [
      { fields: { author: { type: 'User' }, title: 'scalar' }, type: 'Post' },
      { fields: { name: 'scalar' }, type: 'User' },
    ],
  });

  const UserView = view<User>()({ id: true, name: true });
  const PostView = view<Post>()({ author: UserView, id: true, title: true });
  const request = { posts: { list: PostView } };
  client.retain(request);

  await client.request(request);
  client.store.merge(
    toEntityId('Post', 'post-stray'),
    { __typename: 'Post', id: 'post-stray', title: 'Stray' },
    ['__typename', 'id', 'title'],
  );

  client.gc();

  expect(client.store.read(toEntityId('Post', 'post-1'))).toMatchObject({ title: 'Retained' });
  expect(client.store.read(toEntityId('User', 'user-1'))).toMatchObject({ name: 'Kiwi' });
  expect(client.store.read(toEntityId('Post', 'post-stray'))).toBeUndefined();
});

test(`'gc' keeps released operations in the release buffer until it overflows`, async () => {
  type Post = { __typename: 'Post'; id: string; title: string };

  const fetchList = vi.fn(async (_name, _select, args) => ({
    items: [
      {
        cursor: undefined,
        node: {
          __typename: 'Post',
          id: `post-${String(args?.tag)}`,
          title: String(args?.tag),
        },
      },
    ],
    pagination: { hasNext: false, hasPrevious: false },
  }));

  const client = createGCClient({
    gcReleaseBufferSize: 1,
    roots: { posts: clientRoot('Post') },
    transport: {
      async fetchById() {
        return [];
      },
      fetchList,
    },
    types: [{ fields: { title: 'scalar' }, type: 'Post' }],
  });

  const PostView = view<Post>()({ id: true, title: true });
  const requestA = { posts: { args: { tag: 'A' }, list: PostView } };
  const requestB = { posts: { args: { tag: 'B' }, list: PostView } };

  const retainedA = client.retain(requestA);
  await client.request(requestA);
  retainedA.dispose();
  await flushGarbageCollection();

  expect(client.store.read(toEntityId('Post', 'post-A'))).toMatchObject({ title: 'A' });

  const retainedB = client.retain(requestB);
  await client.request(requestB);
  retainedB.dispose();
  await flushGarbageCollection();

  expect(client.store.read(toEntityId('Post', 'post-A'))).toBeUndefined();
  expect(client.store.read(toEntityId('Post', 'post-B'))).toMatchObject({ title: 'B' });
});

test(`'request' refetches fulfilled cache-first handles after gc collects their data`, async () => {
  type Post = { __typename: 'Post'; id: string; title: string };

  const fetchById = vi.fn(async () => [
    {
      __typename: 'Post',
      id: 'post-1',
      title: 'Detail',
    },
  ]);
  const fetchList = vi.fn(async () => ({
    items: [
      {
        cursor: undefined,
        node: {
          __typename: 'Post',
          id: 'post-1',
          title: 'Home',
        },
      },
    ],
    pagination: { hasNext: false, hasPrevious: false },
  }));

  const client = createGCClient({
    gcReleaseBufferSize: 1,
    roots: { post: clientRoot('Post'), posts: clientRoot('Post') },
    transport: {
      fetchById,
      fetchList,
    },
    types: [{ fields: { title: 'scalar' }, type: 'Post' }],
  });

  const PostView = view<Post>()({ id: true, title: true });
  const homeRequest = { posts: { list: PostView } };
  const postRequest = { post: { id: 'post-1', view: PostView } };

  const homeRetain = client.retain(homeRequest);
  const firstHome = await client.request(homeRequest);
  homeRetain.dispose();
  await flushGarbageCollection();

  expect(firstHome.posts.map((post) => post.id)).toEqual(['post-1']);
  expect(fetchList).toHaveBeenCalledTimes(1);

  const postRetain = client.retain(postRequest);
  await client.request(postRequest);
  postRetain.dispose();
  await flushGarbageCollection();

  expect(client.store.getListState('posts')).toBeUndefined();

  const secondHomeRetain = client.retain(homeRequest);
  const secondHome = await client.request(homeRequest);
  secondHomeRetain.dispose();
  await flushGarbageCollection();

  expect(secondHome.posts.map((post) => post.id)).toEqual(['post-1']);
  expect(fetchList).toHaveBeenCalledTimes(2);
});

test(`'gc' does not notify swept child records while their parent is being released`, async () => {
  type Tag = { __typename: 'Tag'; id: string; name: string };
  type Post = {
    __typename: 'Post';
    id: string;
    tags: Array<Tag>;
    title: string;
  };

  const fetchById = vi.fn(async () => []);
  const fetchList = vi.fn(async () => ({
    items: [
      {
        cursor: undefined,
        node: {
          __typename: 'Post',
          id: 'post-1',
          tags: {
            items: [
              {
                node: {
                  __typename: 'Tag',
                  id: 'tag-1',
                  name: 'normalized-cache',
                },
              },
            ],
          },
          title: 'Launch',
        },
      },
    ],
    pagination: { hasNext: false, hasPrevious: false },
  }));

  const client = createGCClient({
    gcReleaseBufferSize: 0,
    roots: { posts: clientRoot('Post') },
    transport: {
      fetchById,
      fetchList,
    },
    types: [
      { fields: { tags: { listOf: 'Tag' }, title: 'scalar' }, type: 'Post' },
      { fields: { name: 'scalar' }, type: 'Tag' },
    ],
  });

  const TagView = view<Tag>()({
    id: true,
    name: true,
  });
  const PostView = view<Post>()({
    id: true,
    tags: {
      items: {
        node: TagView,
      },
    },
    title: true,
  });

  const request = { posts: { list: PostView } };
  const retained = client.retain(request);
  await client.request(request);

  const postRef = client.ref('Post', 'post-1', PostView);
  const tagRef = client.ref('Tag', 'tag-1', TagView);
  client.readView(PostView, postRef);
  client.readView(TagView, tagRef);

  const onTagChange = vi.fn(() => {
    client.readView(TagView, tagRef).then(undefined, () => undefined);
  });
  client.store.subscribe(toEntityId('Tag', 'tag-1'), onTagChange);

  retained.dispose();
  await flushGarbageCollection();

  expect(onTagChange).not.toHaveBeenCalled();
  expect(fetchById).not.toHaveBeenCalledWith('Tag', ['tag-1'], expect.any(Set), undefined);
});

test(`'gc' waits for the next route retain before sweeping released buffered operations`, async () => {
  type EventAttendee = { __typename: 'EventAttendee'; id: string; status: string };
  type Event = {
    __typename: 'Event';
    attendees: Array<EventAttendee>;
    id: string;
    name: string;
  };
  type Post = { __typename: 'Post'; id: string; title: string };

  const fetchById = vi.fn(async () => [
    {
      __typename: 'Post',
      id: 'post-1',
      title: 'Detail',
    },
  ]);
  const fetchList = vi.fn(async () => ({
    items: [
      {
        cursor: undefined,
        node: {
          __typename: 'Event',
          attendees: {
            items: [
              {
                node: {
                  __typename: 'EventAttendee',
                  id: 'attendee-1',
                  status: 'going',
                },
              },
            ],
          },
          id: 'event-1',
          name: 'Launch',
        },
      },
    ],
    pagination: { hasNext: false, hasPrevious: false },
  }));

  const client = createGCClient({
    gcReleaseBufferSize: 1,
    roots: { events: clientRoot('Event'), post: clientRoot('Post') },
    transport: {
      fetchById,
      fetchList,
    },
    types: [
      { fields: { attendees: { listOf: 'EventAttendee' }, name: 'scalar' }, type: 'Event' },
      { fields: { status: 'scalar' }, type: 'EventAttendee' },
      { fields: { title: 'scalar' }, type: 'Post' },
    ],
  });

  const EventAttendeeView = view<EventAttendee>()({
    id: true,
    status: true,
  });
  const EventView = view<Event>()({
    attendees: {
      items: {
        node: EventAttendeeView,
      },
    },
    id: true,
    name: true,
  });
  const PostView = view<Post>()({ id: true, title: true });

  const homeRequest = { events: { list: EventView } };
  const detailRequest = { post: { id: 'post-1', view: PostView } };

  const firstHomeRetain = client.retain(homeRequest);
  await client.request(homeRequest);
  firstHomeRetain.dispose();
  await flushGarbageCollection();

  const detailRetain = client.retain(detailRequest);
  await client.request(detailRequest);

  const renderedHome = await client.request(homeRequest);
  detailRetain.dispose();
  const nextHomeRetain = client.retain(homeRequest);
  await flushGarbageCollection();

  const eventSnapshot = client.readView(EventView, renderedHome.events[0]!);
  expect(eventSnapshot.status).toBe('fulfilled');
  const attendeeRef =
    eventSnapshot.status === 'fulfilled'
      ? ((eventSnapshot.value.data as AnyRecord).attendees as { items: Array<{ node: any }> })
          .items[0]?.node
      : undefined;
  expect(client.store.read(toEntityId('EventAttendee', 'attendee-1'))).toMatchObject({
    status: 'going',
  });
  client.readView(EventAttendeeView, attendeeRef!);

  expect(fetchById).not.toHaveBeenCalledWith(
    'EventAttendee',
    ['attendee-1'],
    expect.any(Set),
    undefined,
  );

  nextHomeRetain.dispose();
  await flushGarbageCollection();
});

test(`'gc' tracks root query args as distinct retained roots`, async () => {
  type User = { __typename: 'User'; id: string; name: string };

  const fetchQuery = vi.fn(async (_name, _select, args) => ({
    __typename: 'User',
    id: `user-${String(args?.viewer)}`,
    name: String(args?.viewer),
  }));

  const client = createGCClient({
    gcReleaseBufferSize: 0,
    roots: { viewer: clientRoot('User') },
    transport: {
      async fetchById() {
        return [];
      },
      fetchQuery,
    },
    types: [{ fields: { name: 'scalar' }, type: 'User' }],
  });

  const UserView = view<User>()({ id: true, name: true });
  const requestA = { viewer: { args: { viewer: 'A' }, view: UserView } };
  const requestB = { viewer: { args: { viewer: 'B' }, view: UserView } };

  client.retain(requestA);
  await client.request(requestA);
  await client.request(requestB);
  client.gc();

  expect(client.store.read(toEntityId('User', 'user-A'))).toMatchObject({ name: 'A' });
  expect(client.store.read(toEntityId('User', 'user-B'))).toBeUndefined();
  expect(client.getRequestResult(requestA).viewer).toMatchObject({ id: 'user-A' });
});
