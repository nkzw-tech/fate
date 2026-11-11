import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { getViewTag, SelectionOf, type View, type ViewData, type ViewRef } from '../types.ts';
import { getViewPayloads, view } from '../view.ts';

type Post = {
  __typename: 'Post';
  content: string;
  id: number;
  likes: number;
  title: string;
};

test('recursive scalar fields allow whole values and finite nested selections', () => {
  type Json = string | null | Array<Json> | { [key: string]: Json };
  type Document = {
    __typename: 'Document';
    content: Record<string, Json>;
    details: { title: string };
  };
  const Whole = view<Document>()({ content: true });
  const Nested = view<Document>()({ content: { child: true }, details: { title: true } });
  expect(getViewPayloads(Whole, null)[0].select).toEqual({ content: true });
  expect(getViewPayloads(Nested, null)[0].select).toEqual({
    content: { child: true },
    details: { title: true },
  });
  // @ts-expect-error Unknown fields on finite objects remain invalid.
  view<Document>()({ details: { missing: true } });
});

test('defines View types with the narrowed selection', () => {
  const FullPostView = view<Post>()({});

  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  expectTypeOf(FullPostView).toEqualTypeOf<View<Post, {}>>();

  const PostView = view<Post>()({
    content: true,
    id: true,
    title: true,
  });

  expectTypeOf(PostView[getViewTag('0')]?.select.content).toEqualTypeOf<true>();

  // @ts-expect-error likes was not selected in the view.
  expect(PostView.select?.likes).toBeUndefined();

  // @ts-expect-error x does not exist.
  expect(PostView.select?.x).toBeUndefined();

  expectTypeOf(PostView).toEqualTypeOf<
    View<
      Post,
      {
        content: true;
        id: true;
        title: true;
      }
    >
  >();
});

test('can compose View types without explicit selections', () => {
  const PostContentView = view<Post>()({
    content: true,
  });

  const PostView = view<Post>()({
    content: true,
    id: true,
    title: true,
  });

  view<Post>()({
    id: true,
    ...PostView,
    ...PostContentView,
  });

  view<Post>()({
    ...PostView,
    ...PostContentView,
  });
});

test('supports nested views and connection selections', () => {
  type User = { __typename: 'User'; id: string; name: string };

  type Comment = {
    __typename: 'Comment';
    author: User;
    content: string;
    id: string;
  };

  type PostWithComments = {
    __typename: 'Post';
    comments: Array<Comment>;
    id: string;
  };

  const AuthorView = view<User>()({
    id: true,
    name: true,
  });

  const CommentView = view<Comment>()({
    author: AuthorView,
    content: true,
    id: true,
  });

  const PostView = view<PostWithComments>()({
    comments: {
      items: {
        node: CommentView,
      },
    },
    id: true,
  });

  type PostData = ViewData<PostWithComments, SelectionOf<typeof PostView>>;

  expectTypeOf<PostData['comments']['items'][number]['node']>().toEqualTypeOf<ViewRef<'Comment'>>();
});

test('infers view refs for standalone live connection selections', () => {
  type User = { __typename: 'User'; id: string; name: string };

  type Comment = {
    __typename: 'Comment';
    author: User;
    content: string;
    id: string;
  };

  type PostWithCommentConnection = {
    __typename: 'Post';
    comments: Array<Comment>;
    id: string;
  };

  const AuthorView = view<User>()({
    id: true,
    name: true,
  });

  const CommentView = view<Comment>()({
    author: AuthorView,
    content: true,
    id: true,
  });

  const CommentConnectionView = {
    args: { first: 3 },
    items: {
      node: CommentView,
    },
    live: {
      append: 'visible',
    },
  };

  const PostView = view<PostWithCommentConnection>()({
    comments: CommentConnectionView,
    id: true,
  });

  type PostData = ViewData<PostWithCommentConnection, SelectionOf<typeof PostView>>;

  expectTypeOf<PostData['comments']['items'][number]['node']>().toEqualTypeOf<ViewRef<'Comment'>>();
});

test('infer view refs for list selections', () => {
  type User = { __typename: 'User'; id: string; name: string };

  type Comment = {
    __typename: 'Comment';
    author: User;
    content: string;
    id: string;
  };

  type PostWithCommentList = {
    __typename: 'Post';
    comments: Array<Comment>;
    id: string;
  };

  const AuthorView = view<User>()({
    id: true,
    name: true,
  });

  const CommentView = view<Comment>()({
    author: AuthorView,
    content: true,
    id: true,
  });

  const PostView = view<PostWithCommentList>()({
    comments: CommentView,
    id: true,
  });

  type PostData = ViewData<PostWithCommentList, SelectionOf<typeof PostView>>;

  expectTypeOf<PostData['comments'][number]>().toEqualTypeOf<ViewRef<'Comment'>>();
});

test('preserves nullability when selecting views', () => {
  type Category = { __typename: 'Category'; id: string };
  type PostWithCategory = {
    __typename: 'Post';
    category: Category | null;
    id: string;
  };

  const CategoryView = view<Category>()({ id: true });
  const PostView = view<PostWithCategory>()({
    category: CategoryView,
    id: true,
  });

  type PostData = ViewData<PostWithCategory, SelectionOf<typeof PostView>>;

  expectTypeOf<PostData['category']>().toEqualTypeOf<ViewRef<'Category'> | null>();
});

test('preserves embedded object types for legacy whole-field selections', () => {
  type UserDetail = {
    __typename: 'UserDetail';
    id: string;
    usage: { totalRequests: number } | null;
    user: { id: string; login: string; plan: 'free' | 'pro' };
  };

  const LegacyUserDetailView = view<UserDetail>()({
    id: true,
    usage: true as never,
    user: true as never,
  });
  type LegacyUserDetailData = ViewData<UserDetail, SelectionOf<typeof LegacyUserDetailView>>;

  expect(getViewPayloads(LegacyUserDetailView, null)[0]?.select).toEqual({
    id: true,
    usage: true,
    user: true,
  });
  expectTypeOf<LegacyUserDetailData['id']>().toEqualTypeOf<string>();
  expectTypeOf<LegacyUserDetailData['user']>().toEqualTypeOf<UserDetail['user']>();
  expectTypeOf<LegacyUserDetailData['usage']>().toEqualTypeOf<UserDetail['usage']>();
});

test('rejects selecting fields not defined on the entity', () => {
  type Fruit = {
    __typename: 'Fruit';
    id: string;
    name: string;
  };

  const FruitSummaryView = view<Fruit>()({
    id: true,
    name: true,
  });

  expectTypeOf(FruitSummaryView).toEqualTypeOf<
    View<
      Fruit,
      {
        id: true;
        name: true;
      }
    >
  >();

  // @ts-expect-error color is not a field on Fruit.
  view<Fruit>()({
    color: true,
    id: true,
  });
});

test('preserves distinct view ids across reloads with remapped paths', async () => {
  const modulePath = new URL('../view.ts', import.meta.url).pathname;
  // Model source maps reporting a different file from import.meta.url.
  const prepareStackTrace = vi
    .spyOn(Error, 'prepareStackTrace')
    .mockImplementation((error, frames) =>
      `${error.name}: ${error.message}\n${frames.map((frame) => `    at ${frame.toString()}`).join('\n')}`.replaceAll(
        modulePath,
        '/node_modules/@nkzw/fate/lib/index.mjs',
      ),
    );

  type Article = {
    __typename: 'Article';
    id: string;
    title: string;
  };

  const loadViewTags = async () => {
    const { getViewNames, view } = await import('../view.ts');

    const ArticleIdView = view<Article>()({
      id: true,
    });

    const ArticleTitleView = view<Article>()({
      id: true,
      title: true,
    });

    return [ArticleIdView, ArticleTitleView].flatMap((articleView) => [
      ...getViewNames(articleView),
    ]);
  };

  try {
    vi.stubEnv('DEV', true);

    vi.resetModules();
    const viewTags = await loadViewTags();
    expect(new Set(viewTags).size).toBe(2);
    for (const tag of viewTags) {
      expect(tag).toMatch(/view\.test\.ts:\d+:\d+$/);
    }

    vi.resetModules();
    expect(viewTags).toEqual(await loadViewTags());
  } finally {
    prepareStackTrace.mockRestore();
    vi.unstubAllEnvs();
  }
});

test('uses a different view id system in development and production', async () => {
  const originalDev = process.env.DEV;
  const originalNodeEnv = process.env.NODE_ENV;

  type Article = {
    __typename: 'Article';
    id: string;
    title: string;
  };

  const loadViewTags = async () => {
    const { getViewNames, view } = await import('../view.ts');

    const ArticleIdView = view<Article>()({
      id: true,
    });

    const ArticleTitleView = view<Article>()({
      id: true,
      title: true,
    });

    return [ArticleIdView, ArticleTitleView].flatMap((articleView) => [
      ...getViewNames(articleView),
    ]);
  };

  try {
    vi.resetModules();
    process.env.DEV = '1';
    process.env.NODE_ENV = 'development';
    const viewTags = await loadViewTags();

    vi.resetModules();
    process.env.DEV = '';
    process.env.NODE_ENV = 'production';
    expect(viewTags).not.toEqual(await loadViewTags());
  } finally {
    process.env.DEV = originalDev;
    process.env.NODE_ENV = originalNodeEnv;
  }
});
