import { expect, expectTypeOf, test } from 'vitest';
import { fragment } from '../fragment.ts';
import type { Fragment } from '../types.ts';

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

  expectTypeOf(PostFragment.select.content).toEqualTypeOf<true>();

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
