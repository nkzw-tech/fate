/**
 * @vitest-environment happy-dom
 */

import {
  createClient,
  clientRoot,
  defer,
  toEntityId,
  view,
  type Deferred,
  type ViewRef,
} from '@nkzw/fate';
import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { FateClient } from '../context.ts';
import { useListView, useView } from '../index.ts';
import { useRequest } from '../useRequest.ts';
import { act, Suspense, useState } from './preact.ts';
import { createRoot } from './preact.ts';

type Post = { __typename: 'Post'; content: string; id: string };

type User = { __typename: 'User'; id: string; name: string };

type Comment = { __typename: 'Comment'; content: string; id: string };

type PostWithAuthor = Post & { author: User };

type PostWithComments = Post & { comments: Array<Comment> };

const DeferredCommentView = view<Comment>()({
  content: true,
  id: true,
});

const DeferredCommentConnectionView = {
  items: { node: DeferredCommentView },
};

const DeferredUserView = view<User>()({
  id: true,
  name: true,
});

const DeferredCommentRow = ({ comment }: { comment: ViewRef<'Comment'> }) => {
  const commentData = useView(DeferredCommentView, comment);
  return <span>{commentData.content}</span>;
};

const DeferredComments = ({
  comments,
}: {
  comments: Deferred<{ items: ReadonlyArray<{ node: ViewRef<'Comment'> }> }>;
}) => {
  const [items] = useListView(DeferredCommentConnectionView, comments);
  return (
    <span>
      {items.map(({ node }) => (
        <DeferredCommentRow comment={node} key={node.id} />
      ))}
    </span>
  );
};

const DeferredAuthor = ({ author }: { author: Deferred<ViewRef<'User'>> }) => {
  const authorData = useView(DeferredUserView, author);
  return <span>{authorData.name}</span>;
};

const flushAsync = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const jsonRoundTrip = <T,>(value: T): T => {
  // eslint-disable-next-line unicorn/prefer-structured-clone -- Verify JSON transport compatibility.
  return JSON.parse(JSON.stringify(value)) as T;
};

test('releases network-only requests on unmount', async () => {
  const fetchById = vi.fn().mockResolvedValue([
    {
      __typename: 'Post',
      id: 'post-1',
    },
  ]);

  const client = createClient({
    roots: {
      post: clientRoot('Post'),
    },
    transport: { fetchById },
    types: [{ type: 'Post' }],
  });

  const PostView = view<Post>()({
    id: true,
  });

  const request = { post: { ids: ['post-1'], view: PostView } };
  const requestKey = client.getRequestKey(request);
  const releaseSpy = vi.spyOn(client, 'releaseRequestKey');

  const Component = () => {
    useRequest(request, { mode: 'network-only' });
    return <span>Post</span>;
  };

  const container = document.createElement('div');
  const reactRoot = createRoot(container);

  await act(async () => {
    reactRoot.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );

    await flushAsync();
  });

  expect(fetchById).toHaveBeenCalledTimes(1);
  expect(releaseSpy).not.toHaveBeenCalled();

  await act(async () => {
    reactRoot.unmount();
    await flushAsync();
  });

  expect(releaseSpy).toHaveBeenCalledWith(requestKey, 'network-only');
});

test('retains cache-first requests while mounted and disposes them on unmount', async () => {
  const fetchById = vi.fn().mockResolvedValue([
    {
      __typename: 'Post',
      content: 'Apple',
      id: 'post-1',
    },
  ]);

  const client = createClient({
    gcReleaseBufferSize: 0,
    roots: {
      post: clientRoot('Post'),
    },
    transport: { fetchById },
    types: [{ fields: { content: 'scalar' }, type: 'Post' }],
  });

  const PostView = view<Post>()({
    content: true,
    id: true,
  });

  const request = { post: { id: 'post-1', view: PostView } };
  const postId = toEntityId('Post', 'post-1');

  const Component = () => {
    useRequest(request);
    return <span>Post</span>;
  };

  const container = document.createElement('div');
  const reactRoot = createRoot(container);

  await act(async () => {
    reactRoot.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );

    await flushAsync();
  });

  expect(client.store.read(postId)).toMatchObject({ content: 'Apple' });

  await act(async () => {
    reactRoot.unmount();
    await flushAsync();
  });

  expect(client.store.read(postId)).toBeUndefined();
});

test('supports requesting a single node through `byId` calls', async () => {
  const fetchById = vi.fn().mockResolvedValue([
    {
      __typename: 'Post',
      content: 'Apple',
      id: 'post-1',
    },
  ]);

  const roots = {
    post: clientRoot('Post'),
  };
  const mutations = {};

  const client = createClient<[typeof roots, typeof mutations]>({
    roots,
    transport: { fetchById },
    types: [{ type: 'Post' }],
  });

  const PostView = view<Post>()({
    content: true,
    id: true,
  });

  const request = { post: { id: 'post-1', view: PostView } };
  const renders: Array<string> = [];

  const Component = () => {
    const { post: postRef } = useRequest<typeof request, typeof roots>(request);
    const post = useView(PostView, postRef);
    renders.push(post.content);
    return <span>{post.content}</span>;
  };

  const container = document.createElement('div');
  const reactRoot = createRoot(container);

  await act(async () => {
    reactRoot.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );
  });

  expect(renders).toEqual(['Apple']);
  expect(fetchById).toHaveBeenCalledTimes(1);
});

test('deferred connection fields suspend inside their own boundary', async () => {
  const comments = Promise.withResolvers<Array<unknown>>();
  const fetchById = vi.fn((_type: string, _ids: Array<string | number>, select: Set<string>) => {
    const paths = [...select];
    if (paths.some((path) => path.startsWith('comments.'))) {
      return comments.promise;
    }

    return Promise.resolve([
      {
        __typename: 'Post',
        content: 'Apple',
        id: 'post-1',
      },
    ]);
  });

  const roots = {
    post: clientRoot('Post'),
  };
  const client = createClient({
    roots,
    transport: { fetchById },
    types: [
      { fields: { comments: { listOf: 'Comment' }, content: 'scalar' }, type: 'Post' },
      { fields: { content: 'scalar' }, type: 'Comment' },
    ],
  });

  const PostView = view<PostWithComments>()({
    comments: defer(DeferredCommentConnectionView),
    content: true,
    id: true,
  });

  const Component = () => {
    const request = { post: { id: 'post-1', view: PostView } };
    const { post: postRef } = useRequest<typeof request, typeof roots>(request);
    const post = useView(PostView, postRef);
    return (
      <>
        <span>{post.content}</span>
        <Suspense fallback={<span>Loading comments</span>}>
          <DeferredComments comments={post.comments} />
        </Suspense>
      </>
    );
  };

  const container = document.createElement('div');
  const reactRoot = createRoot(container);

  await act(async () => {
    reactRoot.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );

    await flushAsync();
  });

  expect(container.textContent).toBe('AppleLoading comments');
  expect(fetchById).toHaveBeenCalledTimes(2);
  expect([...fetchById.mock.calls[0]![2]]).toEqual(['content', 'id']);
  expect([...fetchById.mock.calls[1]![2]]).toEqual(['comments.content', 'comments.id']);

  await act(async () => {
    comments.resolve([
      {
        __typename: 'Post',
        comments: [
          {
            __typename: 'Comment',
            content: 'Banana',
            id: 'comment-1',
          },
        ],
        id: 'post-1',
      },
    ]);
    await flushAsync();
  });

  expect(container.textContent).toBe('AppleBanana');
});

test('switching a rendered list view to a pending deferred connection keeps component state', async () => {
  const pending = Promise.withResolvers<void>();
  const fetchById = vi.fn(
    async (_type: string, ids: Array<string | number>, select: Set<string>) => {
      const withComments = [...select].some((path) => path.startsWith('comments.'));
      if (withComments && ids.includes('post-2')) {
        await pending.promise;
      }
      return ids.map((id) => ({
        __typename: 'Post',
        content: `Content ${id}`,
        id,
        ...(withComments
          ? { comments: [{ __typename: 'Comment', content: `Comment ${id}`, id: `comment-${id}` }] }
          : null),
      }));
    },
  );

  const roots = {
    first: clientRoot('Post'),
    second: clientRoot('Post'),
  };
  const client = createClient({
    roots,
    transport: { fetchById },
    types: [
      { fields: { comments: { listOf: 'Comment' }, content: 'scalar' }, type: 'Post' },
      { fields: { content: 'scalar' }, type: 'Comment' },
    ],
  });

  const PostView = view<PostWithComments>()({
    comments: defer(DeferredCommentConnectionView),
    content: true,
    id: true,
  });

  let setCount!: (count: number) => void;
  const Counter = () => {
    const [count, set] = useState(0);
    setCount = set;
    return <span>{`count:${count} `}</span>;
  };

  let select!: (key: 'first' | 'second') => void;
  const Component = () => {
    const request = {
      first: { id: 'post-1', view: PostView },
      second: { id: 'post-2', view: PostView },
    };
    const posts = useRequest<typeof request, typeof roots>(request);
    const first = useView(PostView, posts.first);
    const second = useView(PostView, posts.second);
    const [selected, setSelected] = useState<'first' | 'second'>('first');
    select = setSelected;
    return (
      <Suspense fallback={<span>Loading comments</span>}>
        <Counter />
        <DeferredComments comments={(selected === 'first' ? first : second).comments} />
      </Suspense>
    );
  };

  const container = document.createElement('div');
  const reactRoot = createRoot(container);

  await act(async () => {
    reactRoot.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );
    await flushAsync();
  });

  await act(async () => {
    setCount(7);
    await flushAsync();
  });
  expect(container.textContent).toBe('count:7 Comment post-1');

  await act(async () => {
    select('second');
    await flushAsync();
  });
  expect(container.textContent).toBe('Loading comments');

  await act(async () => {
    pending.resolve();
    await flushAsync();
  });
  expect(container.textContent).toBe('count:7 Comment post-2');
});

test('deferred entity fields resolve through useView inside their own boundary', async () => {
  const author = Promise.withResolvers<Array<unknown>>();
  const fetchById = vi.fn((_type: string, _ids: Array<string | number>, select: Set<string>) => {
    const paths = [...select];
    if (paths.some((path) => path.startsWith('author.'))) {
      return author.promise;
    }

    return Promise.resolve([
      {
        __typename: 'Post',
        content: 'Apple',
        id: 'post-1',
      },
    ]);
  });

  const roots = {
    post: clientRoot('Post'),
  };
  const client = createClient({
    roots,
    transport: { fetchById },
    types: [
      { fields: { author: { type: 'User' }, content: 'scalar' }, type: 'Post' },
      { fields: { name: 'scalar' }, type: 'User' },
    ],
  });

  const PostView = view<PostWithAuthor>()({
    author: defer(DeferredUserView),
    content: true,
    id: true,
  });

  const Component = () => {
    const request = { post: { id: 'post-1', view: PostView } };
    const { post: postRef } = useRequest<typeof request, typeof roots>(request);
    const post = useView(PostView, postRef);
    return (
      <>
        <span>{post.content}</span>
        <Suspense fallback={<span>Loading author</span>}>
          <DeferredAuthor author={post.author} />
        </Suspense>
      </>
    );
  };

  const container = document.createElement('div');
  const reactRoot = createRoot(container);

  await act(async () => {
    reactRoot.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );

    await flushAsync();
  });

  expect(container.textContent).toBe('AppleLoading author');

  await act(async () => {
    author.resolve([
      {
        __typename: 'Post',
        author: { __typename: 'User', id: 'user-1', name: 'Banana' },
        id: 'post-1',
      },
    ]);
    await flushAsync();
  });

  expect(container.textContent).toBe('AppleBanana');

  await act(async () => {
    client.write(
      'User',
      {
        __typename: 'User',
        id: 'user-1',
        name: 'Cherry',
      },
      new Set(['name']),
    );
    await flushAsync();
  });

  expect(container.textContent).toBe('AppleCherry');
});

test('renders cache-first requests from hydrated SSR state without refetching', async () => {
  const PostView = view<Post>()({
    content: true,
    id: true,
  });
  const roots = {
    post: clientRoot('Post'),
  };
  const server = createClient({
    roots,
    transport: { fetchById: vi.fn() },
    types: [{ fields: { content: 'scalar' }, type: 'Post' }],
  });
  server.write(
    'Post',
    {
      __typename: 'Post',
      content: 'Hydrated',
      id: 'post-1',
    },
    new Set(['content', 'id']),
  );

  const fetchById = vi.fn();
  const browser = createClient({
    roots,
    transport: { fetchById },
    types: [{ fields: { content: 'scalar' }, type: 'Post' }],
  });
  browser.hydrate(jsonRoundTrip(server.dehydrate()));

  const Component = () => {
    const request = { post: { id: 'post-1', view: PostView } };
    const { post } = useRequest<typeof request, typeof roots>(request);
    return <span>{useView(PostView, post).content}</span>;
  };

  const container = document.createElement('div');
  const reactRoot = createRoot(container);

  await act(async () => {
    reactRoot.render(
      <FateClient client={browser}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );
  });

  expect(container.textContent).toBe('Hydrated');
  expect(fetchById).not.toHaveBeenCalled();
});

test('does not refetch network-only inline requests during rerenders with the same key', async () => {
  const fetchById = vi.fn().mockResolvedValue([
    {
      __typename: 'Post',
      content: 'Apple',
      id: 'post-1',
    },
  ]);

  const client = createClient({
    roots: {
      post: clientRoot('Post'),
    },
    transport: { fetchById },
    types: [{ type: 'Post' }],
  });

  const PostView = view<Post>()({
    content: true,
    id: true,
  });
  let rerender: (() => void) | undefined;

  const Component = () => {
    const [count, setCount] = useState(0);
    rerender = () => setCount((value) => value + 1);
    useRequest(
      {
        post: { id: 'post-1', view: PostView },
      },
      { mode: 'network-only' },
    );
    return <span>{count}</span>;
  };

  const container = document.createElement('div');
  const reactRoot = createRoot(container);

  await act(async () => {
    reactRoot.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );

    await flushAsync();
  });

  await act(async () => {
    rerender?.();
    await flushAsync();
  });

  expect(fetchById).toHaveBeenCalledTimes(1);
});

test('refetches network-only inline requests when the request key changes', async () => {
  const fetchById = vi.fn(async (_type: string, ids: Array<string | number>) =>
    ids.map((id) => ({
      __typename: 'Post',
      content: `Post ${id}`,
      id: String(id),
    })),
  );

  const client = createClient({
    roots: {
      post: clientRoot('Post'),
    },
    transport: { fetchById },
    types: [{ type: 'Post' }],
  });

  const PostView = view<Post>()({
    content: true,
    id: true,
  });
  let setPostId: ((id: string) => void) | undefined;

  const Component = () => {
    const [postId, setStatePostId] = useState('post-1');
    setPostId = setStatePostId;
    const { post } = useRequest(
      {
        post: { id: postId, view: PostView },
      },
      { mode: 'network-only' },
    );
    return <span>{post.id}</span>;
  };

  const container = document.createElement('div');
  const reactRoot = createRoot(container);

  await act(async () => {
    reactRoot.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );

    await flushAsync();
  });

  await act(async () => {
    setPostId?.('post-2');
    await flushAsync();
  });

  expect(fetchById).toHaveBeenCalledTimes(2);
  expect(fetchById).toHaveBeenNthCalledWith(
    1,
    'Post',
    ['post-1'],
    new Set(['content', 'id']),
    undefined,
  );
  expect(fetchById).toHaveBeenNthCalledWith(
    2,
    'Post',
    ['post-2'],
    new Set(['content', 'id']),
    undefined,
  );
});

test('makes regular queries nullable or not depending on the root types', async () => {
  type User = { __typename: 'User'; id: string; name: string };

  const roots = {
    user: clientRoot<User, 'User'>('User'),
    viewer: clientRoot<User | null, 'User'>('User'),
  };

  const UserView = view<User>()({
    id: true,
    name: true,
  });

  const request = { user: { view: UserView }, viewer: { view: UserView } };

  const Component = () => {
    const { user, viewer } = useRequest<typeof request, typeof roots>({
      user: { view: UserView },
      viewer: { view: UserView },
    });

    expectTypeOf(user).toEqualTypeOf<ViewRef<'User'>>();
    expectTypeOf(viewer).toEqualTypeOf<ViewRef<'User'> | null>();
  };

  // eslint-disable-next-line no-unused-expressions, @typescript-eslint/no-unused-expressions
  Component;
});
