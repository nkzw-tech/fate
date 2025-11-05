import { expect, expectTypeOf, test } from 'vitest';
import {
  getViewTag,
  SelectionOf,
  type View,
  type ViewData,
  type ViewRef,
} from '../types.ts';
import { view } from '../view.ts';

type Post = {
  __typename: 'Post';
  content: string;
  id: number;
  likes: number;
  title: string;
};

test('defines View types with the narrowed selection', () => {
  const FullPostView = view<Post>()({});

  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  expectTypeOf(FullPostView).toEqualTypeOf<View<Post, {}>>();

  const PostView = view<Post>()({
    content: true,
    id: true,
    title: true,
  });

  expectTypeOf(PostView[getViewTag(0)]?.select.content).toEqualTypeOf<true>();

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

  expectTypeOf<PostData['comments']['items'][number]['node']>().toEqualTypeOf<
    ViewRef<'Comment'>
  >();
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

  expectTypeOf<PostData['comments'][number]>().toEqualTypeOf<
    ViewRef<'Comment'>
  >();
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
