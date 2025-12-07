import type {
  Category,
  Comment as InlineComment,
  Post,
} from '@nkzw/fate-server/src/trpc/router.ts';
import Stack, { VStack } from '@nkzw/stack';
import { cx } from 'class-variance-authority';
import {
  KeyboardEvent,
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useListView, useView, view, ViewRef } from 'react-fate';
import { useFateClient } from 'react-fate';
import { Link } from 'react-router';
import { Button } from '../ui/Button.tsx';
import Card from '../ui/Card.tsx';
import TagBadge, { TagView } from '../ui/TagBadge.tsx';
import AuthClient from '../user/AuthClient.tsx';
import { Badge } from './Badge.tsx';
import CommentCard, { CommentView } from './CommentCard.tsx';
import H3 from './H3.tsx';
import { UserView } from './UserCard.tsx';

const CategorySummaryView = view<Category>()({
  id: true,
  name: true,
});

const CommentConnectionView = {
  args: { first: 3 },
  items: {
    node: CommentView,
  },
} as const;

export const PostView = view<Post>()({
  author: UserView,
  category: CategorySummaryView,
  commentCount: true,
  comments: CommentConnectionView,
  content: true,
  id: true,
  likes: true,
  tags: {
    items: {
      node: TagView,
    },
  },
  title: true,
});

const CommentInput = ({
  error,
  post,
}: {
  error?: Error;
  post: { commentCount: number; id: string };
}) => {
  const fate = useFateClient();
  const { data: session } = AuthClient.useSession();
  const user = session?.user;
  const [commentText, setCommentText] = useState('');

  const [addCommentResult, handleAddComment, addCommentIsPending] = useActionState(async () => {
    const content = commentText.trim();

    if (!content) {
      return;
    }

    const result = await fate.mutations.comment.add({
      input: { content, postId: post.id },
      optimistic: {
        author: user
          ? {
              id: user.id,
              name: user.name ?? 'Anonymous',
            }
          : null,
        content,
        id: `optimistic:${Date.now().toString(36)}`,
        post: { commentCount: post.commentCount + 1, id: post.id },
      },
      view: view<InlineComment>()({
        ...CommentView,
        post: { commentCount: true },
      }),
    });

    setCommentText('');

    return result;
  }, null);

  const maybeSubmitComment = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      startTransition(() => handleAddComment());
    }
  };

  const commentingIsDisabled = addCommentIsPending || commentText.trim().length === 0;

  const anyServerError = error || addCommentResult?.error;

  return (
    <VStack action={handleAddComment} as="form" gap>
      <span className="text-sm font-medium text-foreground">Add a comment</span>
      <textarea
        className="squircle min-h-20 w-full border border-gray-200/80 bg-gray-100/50 p-3 text-sm placeholder-gray-500 transition outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200 disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900/40 dark:placeholder-gray-400"
        disabled={addCommentIsPending}
        onChange={(event) => setCommentText(event.target.value)}
        onKeyDown={maybeSubmitComment}
        placeholder={user?.name ? `Share your thoughts, ${user.name}!` : 'Share your thoughts...'}
        value={commentText}
      />
      {anyServerError ? (
        <p className="text-sm text-destructive">
          {anyServerError instanceof Error
            ? anyServerError.message
            : 'Something went wrong. Please try again.'}
        </p>
      ) : null}
      <Stack end gap>
        <Button disabled={commentingIsDisabled} size="sm" type="submit" variant="secondary">
          Post comment
        </Button>
      </Stack>
    </VStack>
  );
};

export function PostCard({ detail, post: postRef }: { detail?: boolean; post: ViewRef<'Post'> }) {
  const fate = useFateClient();
  const post = useView(PostView, postRef);
  const author = useView(UserView, post.author);
  const category = useView(CategorySummaryView, post.category);
  const [comments, loadNext] = useListView(CommentConnectionView, post.comments);
  const tags = post.tags?.items ?? [];

  const [likeResult, likeAction, likeIsPending] = useActionState(fate.actions.post.like, null);

  const [, unlikeAction, unlikeIsPending] = useActionState(fate.actions.post.unlike, null);

  useEffect(() => {
    if (likeResult?.error) {
      const timeout = setTimeout(() => startTransition(() => likeAction('reset')), 3000);
      return () => clearTimeout(timeout);
    }
  }, [likeAction, likeResult]);

  const handleLike = useCallback(
    async (options?: { error?: 'boundary' | 'callSite'; slow?: boolean }) => {
      likeAction({
        input: { id: post.id, ...options },
        optimistic: { likes: post.likes + 1 },
        view: PostView,
      });
    },
    [likeAction, post.id, post.likes],
  );

  const handleUnlike = useCallback(async () => {
    unlikeAction({
      input: { id: post.id },
      optimistic: {
        likes: Math.max(post.likes - 1, 0),
      },
      view: PostView,
    });
  }, [post.id, post.likes, unlikeAction]);

  return (
    <Card>
      <VStack gap={16}>
        <Stack alignStart between gap={16} wrap>
          <VStack gap>
            <Link to={`/post/${post.id}`}>
              <H3>{post.title}</H3>
            </Link>
            <Stack alignCenter gap wrap>
              {category ? (
                <Link to={`/category/${category.id}`}>
                  <Badge className="bg-blue-50 text-blue-600 transition hover:bg-blue-100 dark:bg-blue-950/50 dark:text-blue-200 dark:hover:bg-blue-900/60">
                    {category.name}
                  </Badge>
                </Link>
              ) : null}
              {tags.length ? (
                <Stack gap wrap>
                  {tags.map(({ node }) => (
                    <TagBadge key={node.id} tag={node} />
                  ))}
                </Stack>
              ) : null}
            </Stack>
          </VStack>
          <Stack alignCenter gap={12} wrap>
            <Stack
              alignCenter
              className="squircle bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 dark:bg-neutral-800 dark:text-white"
              gap
            >
              <span>👍</span>
              <span>
                {post.likes} {post.likes === 1 ? 'like' : 'likes'}
              </span>
            </Stack>
            <Button action={handleLike} disabled={likeIsPending} size="sm" variant="outline">
              Like
            </Button>
            {detail && (
              <Button
                action={() => handleLike({ slow: true })}
                disabled={likeIsPending}
                size="sm"
                variant="outline"
              >
                Like (Slow)
              </Button>
            )}
            {detail && (
              <Button
                action={() => handleLike({ error: 'callSite' })}
                className={cx(
                  'w-32 transition-colors duration-150',
                  likeResult?.error ? 'border-red-500 text-red-500 hover:text-red-500' : '',
                )}
                disabled={likeIsPending}
                size="sm"
                variant="outline"
              >
                {likeResult?.error ? 'Oops, try again!' : `Like (Error)`}
              </Button>
            )}
            {detail && (
              <Button
                action={() => handleLike({ error: 'boundary' })}
                disabled={likeIsPending}
                size="sm"
                variant="outline"
              >
                Like (Network Error)
              </Button>
            )}
            {detail && (
              <Button
                onClick={() =>
                  fate.mutations.post.like({
                    input: { id: post.id },
                    optimistic: { likes: post.likes + 1 },
                    view: PostView,
                  })
                }
                size="sm"
                variant="outline"
              >
                Like (Many)
              </Button>
            )}
            <Button
              action={handleUnlike}
              disabled={unlikeIsPending || post.likes === 0}
              size="sm"
              variant="outline"
            >
              Unlike
            </Button>
          </Stack>
        </Stack>
        <p className="text-sm leading-relaxed text-foreground/90 lg:text-base">{post.content}</p>
        <p className="text-sm text-muted-foreground">- {author?.name ?? 'Unknown author'}</p>
        <VStack gap={16}>
          <h4 className="text-base font-semibold text-foreground">
            {post.commentCount} {post.commentCount === 1 ? 'Comment' : 'Comments'}
          </h4>
          {comments.length > 0 ? (
            <VStack gap={12}>
              {comments.map(({ node }) => (
                <CommentCard comment={node} key={node.id} post={post} />
              ))}
              {loadNext ? (
                <Button onClick={loadNext} variant="ghost">
                  Load more comments
                </Button>
              ) : null}
            </VStack>
          ) : null}
          <ErrorBoundary fallbackRender={({ error }) => <CommentInput error={error} post={post} />}>
            <CommentInput post={post} />
          </ErrorBoundary>
        </VStack>
      </VStack>
    </Card>
  );
}
