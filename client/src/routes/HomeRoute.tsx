import { fragment, FragmentRef, selectFromFragment } from '@nkzw/fate';
import Stack, { VStack } from '@nkzw/stack';
import { FormEvent, Suspense, useCallback, useState } from 'react';
import { useFragment, useQuery } from 'react-fate';
import type { Comment, Post } from '../lib/trpc.tsx';
import { Button } from '../ui/Button.tsx';
import Card from '../ui/Card.tsx';
import H3 from '../ui/H3.tsx';
import Section from '../ui/Section.tsx';
import AuthClient from '../user/AuthClient.tsx';

type SessionUser = {
  id?: string | null;
  name?: string | null;
  username?: string | null;
} | null;

const UserCard = ({ user }: { user: SessionUser }) => {
  if (!user) {
    return null;
  }

  return (
    <Card>
      <VStack gap={4}>
        <H3>Your account</H3>
        <p className="text-muted-foreground text-sm">
          Welcome back{user.name ? `, ${user.name}` : ''}.
        </p>
      </VStack>
    </Card>
  );
};

const CommentFragment = fragment<Comment>()({
  author: { id: true, name: true },
  content: true,
  id: true,
});

const Comment = ({
  comment: commentRef,
}: {
  comment: FragmentRef<'Comment'>;
}) => {
  const comment = useFragment(CommentFragment, commentRef);

  return (
    <div
      className="rounded-md border border-gray-200/80 bg-gray-50/70 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900/40"
      key={comment.id}
    >
      <p className="font-medium text-gray-900 dark:text-gray-200">
        {comment.author?.name ?? 'Anonymous'}
      </p>
      <p className="text-foreground/80">{comment.content}</p>
    </div>
  );
};

const PostFragment = fragment<Post>()({
  author: { id: true, name: true },
  content: true,
  id: true,
  likes: true,
  title: true,
});

const Post = ({
  post: postRef,
  user,
}: {
  post: FragmentRef<'Post'>;
  user: SessionUser;
}) => {
  const post = useFragment(PostFragment, postRef);
  const comments: Array<{ id: string } & FragmentRef<'Comment'>> =
    /*post.comments ?? */ [];

  // @ts-expect-error `createdAt` was not selected in the fragment.
  // eslint-disable-next-line no-console
  console.log(post.createdAt);

  const [commentText, setCommentText] = useState('');

  const likeMutation = { error: null, isPending: false };
  const unlikeMutation = { error: null, isPending: false };
  const addCommentMutation = { error: { message: '' }, isPending: false };
  const handleLike = useCallback(() => {}, []);
  const handleUnlike = useCallback(() => {}, []);

  const handleAddComment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const content = commentText.trim();

    if (!content) {
      return;
    }

    // TODO: Call the mutation.
  };

  const isCommentDisabled =
    addCommentMutation.isPending || commentText.trim().length === 0;

  return (
    <Card>
      <VStack gap={16}>
        <Stack between gap={16}>
          <div>
            <h3 className="text-foreground text-lg font-semibold">
              {post.title}
            </h3>
            <p className="text-muted-foreground text-sm">
              by {post.author?.name ?? 'Unknown author'} · {comments.length}{' '}
              {comments.length === 1 ? 'comment' : 'comments'}
            </p>
          </div>
          <Stack alignCenter gap>
            <Button
              disabled={likeMutation.isPending}
              onClick={handleLike}
              size="sm"
            >
              Like
            </Button>
            <Button
              disabled={unlikeMutation.isPending || post.likes === 0}
              onClick={handleUnlike}
              size="sm"
              variant="outline"
            >
              Unlike
            </Button>
          </Stack>
        </Stack>

        <p className="text-foreground/90 text-sm leading-relaxed">
          {post.content}
        </p>

        <Stack alignCenter className="text-sm font-medium" gap={12} wrap>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-900 dark:bg-gray-950 dark:text-gray-200">
            {post.likes} {post.likes === 1 ? 'like' : 'likes'}
          </span>
        </Stack>
        <VStack gap={16}>
          <h4 className="text-foreground text-base font-semibold">Comments</h4>
          {comments.length > 0 ? (
            <VStack gap={12}>
              {comments.map((comment) => (
                <Comment comment={comment} key={comment.id} />
              ))}
            </VStack>
          ) : null}
          <VStack as="form" gap onSubmit={handleAddComment}>
            <label
              className="text-foreground text-sm font-medium"
              htmlFor={`comment-${post.id}`}
            >
              Add a comment
            </label>
            <textarea
              className="bg-background text-foreground min-h-[80px] w-full rounded-md border border-gray-200 p-3 text-sm placeholder-gray-500 transition outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200 dark:border-neutral-800 dark:focus:border-gray-400 dark:focus:ring-gray-900"
              id={`comment-${post.id}`}
              onChange={(event) => setCommentText(event.target.value)}
              placeholder={
                user?.name
                  ? `Share your thoughts, ${user.name}!`
                  : 'Share your thoughts...'
              }
              value={commentText}
            />
            {addCommentMutation.error ? (
              <p className="text-destructive text-sm">
                {addCommentMutation.error.message}
              </p>
            ) : null}
            <Stack end gap>
              <Button
                disabled={isCommentDisabled}
                size="sm"
                type="submit"
                variant="secondary"
              >
                Post comment
              </Button>
            </Stack>
          </VStack>
        </VStack>
      </VStack>
    </Card>
  );
};

const PostFeed = ({
  posts,
  user,
}: {
  posts: Array<FragmentRef<'Post'>>;
  user: SessionUser | null;
}) => (
  <VStack gap>
    {posts.map((post) => (
      <Post key={post.id} post={post} user={user} />
    ))}
  </VStack>
);

const query = {
  'post.list': {
    args: { first: 20 },
    fields: selectFromFragment(PostFragment),
    type: 'Post',
  },
} as const;

const Home = () => {
  const { data: session } = AuthClient.useSession();
  const user = session?.user;
  const { 'post.list': posts } = useQuery(query);

  return (
    <VStack gap={32}>
      <UserCard user={user ?? null} />
      <VStack gap={16}>
        <H3>Latest posts</H3>
        <PostFeed posts={posts} user={user ?? null} />
      </VStack>
    </VStack>
  );
};

export default function HomeRoute() {
  return (
    <Section>
      <Suspense>
        <Home />
      </Suspense>
    </Section>
  );
}
