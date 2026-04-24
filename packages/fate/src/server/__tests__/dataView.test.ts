import { expect, expectTypeOf, test } from 'vite-plus/test';
import { SelectionOf, ViewData } from '../../types.ts';
import { view } from '../../view.ts';
import {
  attachComputedState,
  computed,
  count,
  createResolver,
  createViewPlan,
  dataView,
  Entity,
  field,
  list,
  resolver,
} from '../dataView.ts';
import { collectDataViewConfigs, createSourceDefinitions, createSourcePlan } from '../source.ts';

type UserItem = { id: string; name: string; password: string };

test('server views filter unexposed fields from selections', async () => {
  const view = dataView<UserItem>('User')({
    id: true,
    name: true,
  });

  const selection = createResolver({
    select: ['name', 'password'],
    view,
  });

  expect(selection.select).toEqual({
    id: true,
    name: true,
  });

  const result = await selection.resolve({
    id: 'user-1',
    name: 'Jane',
    password: 'secret',
  });
  expect(result).toEqual({ id: 'user-1', name: 'Jane' });
});

type CategoryItem = {
  _count?: { posts: number };
  id: string;
  postCount?: number;
};

test('resolvers can add prisma selections and compute values', async () => {
  const view = dataView<CategoryItem>('Category')({
    id: true,
    postCount: resolver<CategoryItem>({
      resolve: ({ _count }) => _count?.posts ?? 0,
      select: () => ({
        _count: { select: { posts: true } },
      }),
    }),
  });

  const selection = createResolver({
    select: ['postCount'],
    view,
  });

  expect(selection.select).toEqual({
    _count: { select: { posts: true } },
    id: true,
  });

  const item = await selection.resolve({ _count: { posts: 4 }, id: 'cat-1' });
  expect(item).toEqual({ id: 'cat-1', postCount: 4 });
});

test('computed fields can resolve hidden source dependencies', async () => {
  const view = dataView<{ email: string; id: string; name: string }>('User')({
    email: computed<{ email: string; id: string; name: string }, string>({
      resolve: (_item, deps) => deps.email as string,
      select: {
        email: field('email'),
      },
    }),
    id: true,
    name: true,
  });

  const selection = createResolver({
    select: ['email', 'name'],
    view,
  });

  const item = await selection.resolve({
    email: 'jane@example.com',
    id: 'user-1',
    name: 'Jane',
  });

  expect(item).toEqual({
    email: 'jane@example.com',
    id: 'user-1',
    name: 'Jane',
  });
});

test('computed fields can resolve conflicting relation counts from attached state', async () => {
  const view = dataView<{ id: string }>('Event')({
    goingCount: computed<{ id: string }, number>({
      resolve: (_item, deps) => (deps.count as number) ?? 0,
      select: {
        count: count('attendees', {
          where: { status: 'GOING' },
        }),
      },
    }),
    id: true,
    waitlistCount: computed<{ id: string }, number>({
      resolve: (_item, deps) => (deps.count as number) ?? 0,
      select: {
        count: count('attendees', {
          where: { status: 'WAITLIST' },
        }),
      },
    }),
  });

  const selection = createResolver({
    select: ['goingCount', 'waitlistCount'],
    view,
  });
  const item = attachComputedState(
    attachComputedState({ id: 'event-1' }, 'goingCount', { count: 4 }),
    'waitlistCount',
    { count: 2 },
  );

  expect(await selection.resolve(item)).toEqual({
    goingCount: 4,
    id: 'event-1',
    waitlistCount: 2,
  });
});

test('a view selection for a resolver has the correct type', async () => {
  const categoryView = dataView<CategoryItem>('Category')({
    id: true,
    postCount: resolver<CategoryItem, number>({
      resolve: ({ _count }) => _count?.posts ?? 0,
      select: () => ({
        _count: { select: { posts: true } },
      }),
    }),
  });

  type Category = Entity<typeof categoryView, 'Category'>;

  const CategoryView = view<Category>()({
    postCount: true,
  });

  type CategoryData = ViewData<Category, SelectionOf<typeof CategoryView>>;

  expectTypeOf<CategoryData['postCount']>().toEqualTypeOf<number>();
});

type ChildItem = {
  _count?: { items: number };
  id: string;
  total?: number;
};

type ParentItem = {
  child?: ChildItem | null;
  id: string;
};

test('nested resolvers apply their selections within relations', async () => {
  const childView = dataView<ChildItem>('Child')({
    id: true,
    total: resolver<ChildItem>({
      resolve: ({ _count }) => _count?.items ?? 0,
      select: () => ({
        _count: { select: { items: true } },
      }),
    }),
  });

  const parentView = dataView<ParentItem>('Parent')({
    child: childView,
    id: true,
  });

  const selection = createResolver({
    select: ['child.total'],
    view: parentView,
  });

  expect(selection.select).toEqual({
    child: {
      select: {
        _count: { select: { items: true } },
        id: true,
      },
    },
    id: true,
  });

  const item = await selection.resolve({
    child: { _count: { items: 7 }, id: 'child-1' },
    id: 'parent-1',
  });

  expect((item.child as any)?.total).toBe(7);
});

type PostItem = { id: string; secret: string; title: string };

type CommentItem = { id: string; post?: PostItem | null };

test('selecting a relation without nested paths only selects minimal fields', () => {
  const postView = dataView<PostItem>('Post')({
    id: true,
    title: true,
  });

  const commentView = dataView<CommentItem>('Comment')({
    id: true,
    post: postView,
  });

  const selection = createResolver({
    select: ['post'],
    view: commentView,
  });

  expect(selection.select).toEqual({
    id: true,
    post: { select: { id: true } },
  });
});

test('relation selections without nested paths do not expose unrequested fields', async () => {
  const postView = dataView<PostItem>('Post')({
    id: true,
    secret: true,
    title: true,
  });

  const commentView = dataView<CommentItem>('Comment')({
    id: true,
    post: postView,
  });

  const { resolve } = createResolver({
    select: ['post'],
    view: commentView,
  });

  const item = await resolve({
    id: 'comment-1',
    post: { id: 'post-1', secret: 'hidden', title: 'Hello' },
  });

  expect(item.post).toEqual({ id: 'post-1' });
});

type AuthorItem = { id: string; name: string };

type ReplyItem = { author?: AuthorItem | null; id: string };

type CommentWithRepliesItem = { id: string; replies?: Array<ReplyItem> };

type PostWithDeepRelationsItem = { comments?: Array<CommentWithRepliesItem>; id: string };

test('list fields are wrapped into connections recursively using scoped args', async () => {
  const authorView = dataView<AuthorItem>('Author')({
    id: true,
    name: true,
  });

  const replyView = dataView<ReplyItem>('Reply')({
    author: authorView,
    id: true,
  });

  const commentView = dataView<CommentWithRepliesItem>('Comment')({
    id: true,
    replies: list(replyView),
  });

  const postView = dataView<PostWithDeepRelationsItem>('Post')({
    comments: list(commentView),
    id: true,
  });

  const { resolve } = createResolver({
    args: { comments: { first: 2, replies: { before: 'reply-2', last: 1 } } },
    select: ['comments.replies.author.name'],
    view: postView,
  });

  const result = await resolve({
    comments: [
      {
        id: 'comment-1',
        replies: [
          { author: { id: 'author-1', name: 'Ada' }, id: 'reply-1' },
          { author: { id: 'author-2', name: 'Bea' }, id: 'reply-2' },
        ],
      },
    ],
    id: 'post-1',
  });

  const commentsConnection = result.comments as any;
  expect(commentsConnection?.items).toHaveLength(1);

  const repliesConnection = commentsConnection?.items[0]?.node?.replies;
  expect(repliesConnection?.items).toHaveLength(1);
  expect(repliesConnection?.items[0]?.node?.author?.name).toBe('Ada');
  expect(repliesConnection?.pagination?.hasPrevious).toBe(false);
});

test('prebuilt nested connections are preserved during resolution', async () => {
  const authorView = dataView<AuthorItem>('Author')({
    id: true,
    name: true,
  });

  const commentView = dataView<CommentWithRepliesItem>('Comment')({
    id: true,
    replies: list(
      dataView<ReplyItem>('Reply')({
        author: authorView,
        id: true,
      }),
    ),
  });

  const postView = dataView<PostWithDeepRelationsItem>('Post')({
    comments: list(commentView),
    id: true,
  });

  const plan = createViewPlan({
    select: ['comments.replies.author.name'],
    view: postView,
  });

  const result = await plan.resolve({
    comments: {
      items: [
        {
          cursor: 'comment-1',
          node: {
            id: 'comment-1',
            replies: {
              items: [
                {
                  cursor: 'reply-1',
                  node: {
                    author: { id: 'author-1', name: 'Ada', secret: 'ignored' },
                    id: 'reply-1',
                  },
                },
              ],
              pagination: {
                hasNext: false,
                hasPrevious: false,
                nextCursor: 'reply-1',
                previousCursor: undefined,
              },
            },
          },
        },
      ],
      pagination: {
        hasNext: true,
        hasPrevious: false,
        nextCursor: 'comment-1',
        previousCursor: undefined,
      },
    } as any,
    id: 'post-1',
  });

  expect(result.comments).toEqual({
    items: [
      {
        cursor: 'comment-1',
        node: {
          id: 'comment-1',
          replies: {
            items: [
              {
                cursor: 'reply-1',
                node: {
                  author: { id: 'author-1', name: 'Ada' },
                  id: 'reply-1',
                },
              },
            ],
            pagination: {
              hasNext: false,
              hasPrevious: false,
              nextCursor: 'reply-1',
              previousCursor: undefined,
            },
          },
        },
      },
    ],
    pagination: {
      hasNext: true,
      hasPrevious: false,
      nextCursor: 'comment-1',
      previousCursor: undefined,
    },
  });
});

type SessionContext = { sessionUserId?: string };

type UserWithEmailItem = { email: string; id: string; name: string };

test('authorized resolvers can access context and return null when unauthorized', async () => {
  const userDataView = dataView<UserWithEmailItem>('User')({
    email: resolver<UserWithEmailItem, string | null, SessionContext>({
      authorize: ({ id }, context) => context?.sessionUserId === id,
      resolve: ({ email }) => email,
      select: { email: true },
    }),
    id: true,
    name: true,
  });

  const selfSelection = createResolver({
    ctx: { sessionUserId: 'user-1' },
    select: ['email'],
    view: userDataView,
  });

  expect(
    (
      await selfSelection.resolve({
        email: 'jane@example.com',
        id: 'user-1',
        name: 'Jane',
      })
    ).email,
  ).toBe('jane@example.com');

  const otherSelection = createResolver({
    ctx: { sessionUserId: 'user-2' },
    select: ['email'],
    view: userDataView,
  });

  expect(
    (
      await otherSelection.resolve({
        email: 'jane@example.com',
        id: 'user-1',
        name: 'Jane',
      })
    ).email,
  ).toBeNull();

  type User = Entity<typeof userDataView, 'User'>;

  const UserView = view<User>()({
    email: true,
    name: true,
  });

  type UserData = ViewData<User, SelectionOf<typeof UserView>>;

  expectTypeOf<UserData['name']>().toEqualTypeOf<string>();
  expectTypeOf<UserData['email']>().toEqualTypeOf<string | null>();
});

test('createViewPlan exposes scoped args for nested relations', () => {
  const authorView = dataView<AuthorItem>('Author')({
    id: true,
    name: true,
  });

  const replyView = dataView<ReplyItem>('Reply')({
    author: authorView,
    id: true,
  });

  const commentView = dataView<CommentWithRepliesItem>('Comment')({
    id: true,
    replies: list(replyView),
  });

  const postView = dataView<PostWithDeepRelationsItem>('Post')({
    comments: list(commentView),
    id: true,
  });

  const plan = createViewPlan({
    args: {
      comments: {
        first: 2,
        replies: {
          before: 'reply-2',
          last: 1,
        },
      },
    },
    select: ['comments.replies.author.name'],
    view: postView,
  });

  const commentsNode = plan.root.relations.get('comments');
  const repliesNode = commentsNode?.relations.get('replies');

  expect(commentsNode?.args).toEqual({
    first: 2,
    replies: {
      before: 'reply-2',
      last: 1,
    },
  });
  expect(repliesNode?.args).toEqual({
    before: 'reply-2',
    last: 1,
  });
});

test('createSourcePlan attaches source order metadata', () => {
  const commentView = dataView<{ createdAt: Date; id: string }>('Comment')({
    id: true,
  });

  const postView = dataView<{ comments?: Array<{ createdAt: Date; id: string }>; id: string }>(
    'Post',
  )({
    comments: list(commentView),
    id: true,
  });

  const [, postSource] = createSourceDefinitions([
    {
      orderBy: [{ direction: 'desc', field: 'createdAt' }],
      view: commentView,
    },
    {
      orderBy: [{ direction: 'asc', field: 'id' }],
      relations: {
        comments: {
          foreignKey: 'postId',
          localKey: 'id',
          orderBy: [{ direction: 'desc', field: 'createdAt' }],
        },
      },
      view: postView,
    },
  ]);

  const plan = createSourcePlan({
    select: ['comments.id'],
    source: postSource,
  });

  expect(plan.root.orderBy).toEqual([{ direction: 'asc', field: 'id' }]);
  expect((plan.root.relations.get('comments') as typeof plan.root | undefined)?.orderBy).toEqual([
    { direction: 'desc', field: 'createdAt' },
    { direction: 'asc', field: 'id' },
  ]);
});

test('collectDataViewConfigs reads list order defaults', () => {
  const postView = dataView<{ createdAt: Date; id: string }>('Post')({
    id: true,
  });

  const [config] = collectDataViewConfigs({
    posts: list(postView, { orderBy: { createdAt: 'desc', id: 'desc' } }),
  });

  expect(config?.orderBy).toEqual([
    { direction: 'desc', field: 'createdAt' },
    { direction: 'desc', field: 'id' },
  ]);
  expect(config?.view).toBe(postView);
});
