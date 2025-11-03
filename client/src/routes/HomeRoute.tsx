import Stack, { VStack } from '@nkzw/stack';
import { FormEvent, Suspense, useCallback, useState } from 'react';
import { useMutation, useRequest, useView, view, ViewRef } from 'react-fate';
import type { Comment, Post } from '../lib/fate.tsx';
import { fate } from '../lib/fate.tsx';
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

const AuthorView = view<Post['author']>()({
  id: true,
  name: true,
});

const CommentView = view<Comment>()({
  author: AuthorView,
  content: true,
  id: true,
});

const Comment = ({ comment: commentRef }: { comment: ViewRef<'Comment'> }) => {
  const comment = useView(CommentView, commentRef);
  const author = useView(AuthorView, comment.author);

  return (
    <div
      className="rounded-md border border-gray-200/80 bg-gray-50/70 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900/40"
      key={comment.id}
    >
      <p className="font-medium text-gray-900 dark:text-gray-200">
        {author?.name ?? 'Anonymous'}
      </p>
      <p className="text-foreground/80">{comment.content}</p>
    </div>
  );
};

const PostView = view<Post>()({
  author: AuthorView,
  comments: {
    edges: {
      node: CommentView,
    },
  },
  content: true,
  id: true,
  likes: true,
  title: true,
});

const Post = ({
  post: postRef,
  user,
}: {
  post: ViewRef<'Post'>;
  user: SessionUser;
}) => {
  const post = useView(PostView, postRef);
  const author = useView(AuthorView, post.author);
  const comments = post.comments?.edges ?? [];

  const [commentText, setCommentText] = useState('');

  const [likePost, likeIsPending] = useMutation(fate.mutations.likePost);
  const [unlikePost, unlikeIsPending] = useMutation(fate.mutations.unlikePost);
  const [addCommentMutation, addCommentIsPending, addCommentError] =
    useMutation(fate.mutations.addComment);

  const handleLike = useCallback(async () => {
    await likePost({
      input: { id: post.id },
      optimisticUpdate: { likes: post.likes + 1 },
    });
  }, [likePost, post.id, post.likes]);

  const handleUnlike = useCallback(async () => {
    await unlikePost({
      input: { id: post.id },
      optimisticUpdate: {
        likes: Math.max(post.likes - 1, 0),
      },
    });
  }, [post.id, post.likes, unlikePost]);

  const handleAddComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const content = commentText.trim();

    if (!content) {
      return;
    }

    await addCommentMutation({
      input: { content, postId: post.id },
    });

    setCommentText('');
  };

  const isCommentDisabled =
    addCommentIsPending || commentText.trim().length === 0;

  return (
    <Card>
      <VStack gap={16}>
        <Stack between gap={16}>
          <div>
            <h3 className="text-foreground text-lg font-semibold">
              {post.title}
            </h3>
            <p className="text-muted-foreground text-sm">
              by {author?.name ?? 'Unknown author'} · {comments.length}{' '}
              {comments.length === 1 ? 'comment' : 'comments'}
            </p>
          </div>
          <Stack alignCenter gap>
            <Button disabled={likeIsPending} onClick={handleLike} size="sm">
              Like
            </Button>
            <Button
              disabled={unlikeIsPending || post.likes === 0}
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
              {comments.map((edge) => (
                <Comment comment={edge.node} key={edge.node.id} />
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
              className="bg-background text-foreground min-h-20 w-full rounded-md border border-gray-200 p-3 text-sm placeholder-gray-500 transition outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200 dark:border-neutral-800 dark:focus:border-gray-400 dark:focus:ring-gray-900"
              id={`comment-${post.id}`}
              onChange={(event) => setCommentText(event.target.value)}
              placeholder={
                user?.name
                  ? `Share your thoughts, ${user.name}!`
                  : 'Share your thoughts...'
              }
              value={commentText}
            />
            {addCommentError ? (
              <p className="text-destructive text-sm">
                {addCommentError instanceof Error
                  ? addCommentError.message
                  : 'Something went wrong. Please try again.'}
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
  posts: Array<ViewRef<'Post'>>;
  user: SessionUser | null;
}) => (
  <VStack gap>
    {posts.map((post) => (
      <Post key={post.id} post={post} user={user} />
    ))}
  </VStack>
);

const Likes = ({ posts }: { posts: Array<ViewRef<'Post'>> }) => {
  const post = useView(LikesView, posts[0]);

  return (
    <span className="text-foreground/80 text-sm">
      <span>Latest Post:</span> {post.title} - {post.likes} likes
    </span>
  );
};

const LikesView = view<Post>()({
  likes: true,
  title: true,
});

const RootView = view<Post>()({
  ...LikesView,
  ...PostView,
});

const request = {
  posts: {
    args: { first: 20 },
    root: RootView,
    type: 'Post',
  },
} as const;

const Home = () => {
  const { data: session } = AuthClient.useSession();
  const user = session?.user;
  const { posts } = useRequest(request);

  return (
    <VStack gap={32}>
      <UserCard user={user ?? null} />
      <VStack gap={16}>
        <Stack alignCenter between gap={16}>
          <H3>Latest posts</H3>
          <Likes posts={posts} />
        </Stack>
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
