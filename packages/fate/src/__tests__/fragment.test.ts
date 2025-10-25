import { expect, expectTypeOf, test } from 'vitest';
import { fragment } from '../fragment.ts';
import {
  getFragmentTag,
  SelectionOf,
  type Fragment,
  type FragmentData,
  type FragmentRef,
} from '../types.ts';

type Post = {
  __typename: 'Post';
  content: string;
  id: number;
  likes: number;
  title: string;
};

test('defines Fragment types with the narrowed selection', () => {
  const FullPostFragment = fragment<Post>()({});

  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  expectTypeOf(FullPostFragment).toEqualTypeOf<Fragment<Post, {}>>();

  const PostFragment = fragment<Post>()({
    content: true,
    id: true,
    title: true,
  });

  expectTypeOf(
    PostFragment[getFragmentTag(0)]?.select.content,
  ).toEqualTypeOf<true>();

  // @ts-expect-error likes was not selected in the fragment.
  expect(PostFragment.select?.likes).toBeUndefined();

  // @ts-expect-error x does not exist.
  expect(PostFragment.select?.x).toBeUndefined();

  expectTypeOf(PostFragment).toEqualTypeOf<
    Fragment<
      Post,
      {
        content: true;
        id: true;
        title: true;
      }
    >
  >();
});

test('supports nested fragments and connection selections', () => {
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

  const AuthorFragment = fragment<User>()({
    id: true,
    name: true,
  });

  const CommentFragment = fragment<Comment>()({
    author: AuthorFragment,
    content: true,
    id: true,
  });

  const PostFragment = fragment<PostWithComments>()({
    comments: {
      edges: {
        node: CommentFragment,
      },
    },
    id: true,
  });

  type PostData = FragmentData<
    PostWithComments,
    SelectionOf<typeof PostFragment>
  >;

  expectTypeOf<PostData['comments']['edges'][number]['node']>().toEqualTypeOf<
    FragmentRef<'Comment'>
  >();
});

test('infer fragment refs for list selections', () => {
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

  const AuthorFragment = fragment<User>()({
    id: true,
    name: true,
  });

  const CommentFragment = fragment<Comment>()({
    author: AuthorFragment,
    content: true,
    id: true,
  });

  const PostFragment = fragment<PostWithCommentList>()({
    comments: CommentFragment,
    id: true,
  });

  type PostData = FragmentData<
    PostWithCommentList,
    SelectionOf<typeof PostFragment>
  >;

  expectTypeOf<PostData['comments'][number]>().toEqualTypeOf<
    FragmentRef<'Comment'>
  >();
});
