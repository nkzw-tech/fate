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
import { act, StrictMode, Suspense, use, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { FateClient } from '../context.tsx';
import { useListView, useView } from '../index.tsx';
import { useRequest } from '../useRequest.tsx';

// @ts-expect-error React 🤷‍♂️
global.IS_REACT_ACT_ENVIRONMENT = true;

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

// Known regression: the old component still owns the fulfilled handle when its
// replacement renders. Remove `.fails` once freshness and retry sharing both pass.
test.fails.each([
  { mode: 'network-only', timeout: undefined },
  { mode: 'network-only', timeout: 5000 },
  { mode: 'stale-while-revalidate', timeout: undefined },
  { mode: 'stale-while-revalidate', timeout: 5000 },
] as const)(
  'refreshes $mode ($timeout) when a keyed component replaces its owner',
  async (options) => {
    let content = 'Before';
    const committed: Array<string> = [];
    const fetchById = vi.fn(async () => [{ __typename: 'Post', content, id: 'post-1' }]);
    const client = createClient({
      roots: { post: clientRoot('Post') },
      transport: { fetchById },
      types: [{ fields: { content: 'scalar' }, type: 'Post' }],
    });
    const PostView = view<Post>()({ content: true, id: true });
    const Component = () => {
      const { post } = useRequest({ post: { id: 'post-1', view: PostView } }, options);
      const { content } = useView(PostView, post);
      useLayoutEffect(() => {
        committed.push(content);
      }, [content]);
      return <span>{content}</span>;
    };
    const container = document.createElement('div');
    const root = createRoot(container);
    const render = (key: number) => (
      <FateClient client={client}>
        <Suspense fallback={<span>Loading</span>}>
          <Component key={key} />
        </Suspense>
      </FateClient>
    );

    try {
      await act(async () => {
        root.render(render(0));
        await flushAsync();
      });
      expect(container.textContent).toBe('Before');
      expect(fetchById).toHaveBeenCalledTimes(1);

      content = 'After';
      await act(async () => {
        root.render(render(1));
        await flushAsync();
      });
      expect(fetchById).toHaveBeenCalledTimes(2);
      expect(container.textContent).toBe('After');
      if (options.mode === 'network-only') {
        // A refresh after committing the old value is not a network-only fix.
        expect(committed).toEqual(['Before', 'After']);
      }
    } finally {
      await act(async () => root.unmount());
    }
  },
);

test('shares a network-only request with a consumer that commits after another boundary', async () => {
  const blocker = Promise.withResolvers<void>();
  const fetchById = vi.fn(async () => [{ __typename: 'Post', content: 'Shared', id: 'post-1' }]);
  const client = createClient({
    roots: { post: clientRoot('Post') },
    transport: { fetchById },
    types: [{ fields: { content: 'scalar' }, type: 'Post' }],
  });
  const PostView = view<Post>()({ content: true, id: true });
  const Component = ({ delayed = false }: { delayed?: boolean }) => {
    const { post } = useRequest(
      { post: { id: 'post-1', view: PostView } },
      { mode: 'network-only' },
    );
    if (delayed) {
      use(blocker.promise);
    }
    return <span>{useView(PostView, post).content}</span>;
  };
  const container = document.createElement('div');
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <FateClient client={client}>
          <Suspense fallback={<span>First loading</span>}>
            <Component />
          </Suspense>
          <Suspense fallback={<span>Second loading</span>}>
            <Component delayed />
          </Suspense>
        </FateClient>,
      );
      await flushAsync();
    });
    expect(container.textContent).toBe('SharedSecond loading');
    expect(fetchById).toHaveBeenCalledTimes(1);

    await act(async () => {
      blocker.resolve();
      await flushAsync();
    });
    expect(container.textContent).toBe('SharedShared');
    expect(fetchById).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
  }
});

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
  const { promise } = client.prepareRequestForRender(request, { mode: 'network-only' });

  await act(async () => {
    reactRoot.unmount();
    await flushAsync();
  });

  expect(releaseSpy).toHaveBeenCalledWith(requestKey, 'network-only', promise);
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

test.each(['network-only', 'stale-while-revalidate'] as const)(
  'retains mounted %s data through Strict Mode effect replay',
  async (mode) => {
    const fetchById = vi
      .fn()
      .mockResolvedValue([{ __typename: 'Post', content: 'Apple', id: 'post-1' }]);
    const client = createClient({
      gcReleaseBufferSize: 0,
      roots: { post: clientRoot('Post') },
      transport: { fetchById },
      types: [{ fields: { content: 'scalar' }, type: 'Post' }],
    });
    const PostView = view<Post>()({ content: true, id: true });
    const postId = toEntityId('Post', 'post-1');
    const Component = () => {
      const { post } = useRequest(
        { post: { id: 'post-1', view: PostView } },
        { mode, timeout: 5000 },
      );
      return <span>{useView(PostView, post).content}</span>;
    };
    const container = document.createElement('div');
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <FateClient client={client}>
            <StrictMode>
              <Suspense fallback="Loading">
                <Component />
              </Suspense>
            </StrictMode>
          </FateClient>,
        );
        await flushAsync();
      });
      await act(async () => {
        client.gc();
        await flushAsync();
      });
      expect(client.store.read(postId)).toMatchObject({ content: 'Apple' });
      expect(container.textContent).toBe('Apple');
      expect(fetchById).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        root.unmount();
        await flushAsync();
      });
    }
    expect(client.store.read(postId)).toBeUndefined();
  },
);

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
    const { post: postRef } = useRequest({ post: { id: 'post-1', view: PostView } });
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
    const { post: postRef } = useRequest({ post: { id: 'post-1', view: PostView } });
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
    const { post } = useRequest({ post: { id: 'post-1', view: PostView } });
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

test.each([undefined, 5000])(
  'keeps a replacement reader prepared after the old cleanup (timeout=%s)',
  async (timeout) => {
    const fetchById = vi
      .fn()
      .mockResolvedValue([{ __typename: 'Post', content: 'Apple', id: 'post-1' }]);
    const client = createClient({
      roots: { post: clientRoot('Post') },
      transport: { fetchById },
      types: [{ fields: { content: 'scalar' }, type: 'Post' }],
    });
    const PostView = view<Post>()({ content: true, id: true });
    const request = { post: { id: 'post-1', view: PostView } };
    const options = { mode: 'network-only', timeout } as const;
    const Component = ({ count }: { count: number }) => {
      const { post } = useRequest({ post: { id: 'post-1', view: PostView } }, options);
      return (
        <span>
          {useView(PostView, post).content}:{count}
        </span>
      );
    };
    const container = document.createElement('div');
    const root = createRoot(container);
    const render = (key: number, count = 0) => (
      <FateClient client={client}>
        <Suspense fallback="Loading">
          <Component count={count} key={key} />
        </Suspense>
      </FateClient>
    );

    try {
      await act(async () => {
        root.render(render(0));
        await flushAsync();
      });
      expect(container.textContent).toBe('Apple:0');
      expect(fetchById).toHaveBeenCalledTimes(1);

      fetchById.mockResolvedValue([{ __typename: 'Post', content: 'Banana', id: 'post-1' }]);
      await act(async () => {
        await client.request(request, options);
        root.render(render(1));
        await flushAsync();
      });
      expect(container.textContent).toBe('Banana:0');
      expect(fetchById).toHaveBeenCalledTimes(2);

      await act(async () => {
        root.render(render(1, 1));
        await flushAsync();
      });
      expect(container.textContent).toBe('Banana:1');
      expect(fetchById).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => root.unmount());
    }
  },
);

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

    const cached = useRequest<typeof request, typeof roots>(request, { mode: 'cache-only' });
    expectTypeOf(cached?.user).toEqualTypeOf<ViewRef<'User'> | undefined>();
    expectTypeOf(cached?.viewer).toEqualTypeOf<ViewRef<'User'> | null | undefined>();
    expectTypeOf(user).toEqualTypeOf<ViewRef<'User'>>();
    expectTypeOf(viewer).toEqualTypeOf<ViewRef<'User'> | null>();
  };

  // eslint-disable-next-line no-unused-expressions, @typescript-eslint/no-unused-expressions
  Component;
});

test('cache-only requests observe misses and later writes without fetching or suspending', async () => {
  const fetchById = vi.fn(async () => [{ id: '1', name: 'Sam' }]);
  const roots = { user: clientRoot<User, 'User'>('User') };
  const client = createClient({
    roots,
    transport: { fetchById },
    types: [{ type: 'User' }],
  });
  const selected = view<User>()({ name: true });
  const request = { user: { id: '1', view: selected } };
  function Cached() {
    const result = useRequest<typeof request, typeof roots>(request, { mode: 'cache-only' });
    const user = useView(selected, result?.user);
    return <span>{user?.name ?? 'missing'}</span>;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <FateClient client={client}>
        <Suspense fallback="loading">
          <Cached />
        </Suspense>
      </FateClient>,
    ),
  );
  expect(container.textContent).toBe('missing');
  expect(fetchById).not.toHaveBeenCalled();
  await act(async () => client.write('User', { id: '1', name: 'Maxima' }, new Set(['name'])));
  expect(container.textContent).toBe('Maxima');
  expect(fetchById).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

test('switching offline while a request is pending keeps local state and skips its Suspense gate', async () => {
  const pending = Promise.withResolvers<Array<{ id: string; name: string }>>();
  const fetchById = vi.fn(() => pending.promise);
  const roots = { user: clientRoot<User, 'User'>('User') };
  const client = createClient({
    roots,
    transport: { fetchById },
    types: [{ type: 'User' }],
  });
  const selected = view<User>()({ name: true });
  const request = { user: { id: '1', view: selected } };
  let setCount: ((count: number) => void) | undefined;
  function Screen({ online }: { online: boolean }) {
    const [count, update] = useState(0);
    setCount = update;
    const result = useRequest<typeof request, typeof roots>(request, {
      mode: online ? 'network-only' : 'cache-only',
    });
    const user = useView(selected, result?.user);
    return (
      <span>
        {count}:{user?.name ?? 'missing'}
      </span>
    );
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  const render = (online: boolean) =>
    act(async () =>
      root.render(
        <FateClient client={client}>
          <Suspense fallback="loading">
            <Screen online={online} />
          </Suspense>
        </FateClient>,
      ),
    );
  await render(false);
  await act(async () => setCount?.(7));
  await render(true);
  await render(false);
  expect(container.textContent).toBe('7:missing');
  expect(fetchById).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve([{ id: '1', name: 'Sam' }]));
  expect(container.textContent).toBe('7:Sam');
  await render(true);
  expect(container.textContent).toBe('7:Sam');
  await act(async () => root.unmount());
});

test('a Suspense query with child arguments satisfies a cache-only summary of the same root', async () => {
  const roots = { user: clientRoot<User, 'User'>('User') };
  const fetchQuery = vi.fn(async () => ({ id: '1', name: 'Sam' }));
  const client = createClient({
    roots,
    transport: { fetchById: async () => [], fetchQuery },
    types: [{ type: 'User' }],
  });
  const summary = { user: { args: { username: 'Sam' }, view: view<User>()({ id: true }) } };
  const detail = {
    user: {
      args: { username: 'Sam' },
      view: view<User>()({ id: true, name: { args: { locale: 'en' } } }),
    },
  };
  function Screen() {
    const cached = useRequest<typeof summary, typeof roots>(summary, { mode: 'cache-only' });
    const loaded = useRequest<typeof detail, typeof roots>(detail, { mode: 'network-only' });
    return (
      <span>
        {cached?.user ? 'cached' : 'missing'}:{loaded.user.id}
      </span>
    );
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <FateClient client={client}>
        <Suspense fallback="loading">
          <Screen />
        </Suspense>
      </FateClient>,
    ),
  );
  expect(container.textContent).toBe('cached:1');
  expect(fetchQuery).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});
