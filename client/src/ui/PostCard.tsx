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
  useTransition,
} from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useListView, useView, view, ViewRef } from 'react-fate';
import { Link } from 'react-router';
import { fate } from '../lib/fate.tsx';
import { Button } from '../ui/Button.tsx';
import Card from '../ui/Card.tsx';
import TagBadge, { TagView } from '../ui/TagBadge.tsx';
import AuthClient from '../user/AuthClient.tsx';
import CommentCard, { CommentView } from './CommentCard.tsx';
import { UserView } from './UserCard.tsx';

const CategorySummaryView = view<Category>()({
  id: true,
  name: true,
});

export const PostView = view<Post>()({
  author: UserView,
  category: CategorySummaryView,
  commentCount: true,
  comments: {
    args: { first: 3 },
    items: {
      node: CommentView,
    },
  },
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
  const { data: session } = AuthClient.useSession();
  const user = session?.user;
  const [commentText, setCommentText] = useState('');

  const [addCommentResult, handleAddComment, addCommentIsPending] =
    useActionState(async () => {
      const content = commentText.trim();

      if (!content) {
        return;
      }

      const result = await fate.mutations.addComment({
        input: { content, postId: post.id },
        optimisticUpdate: {
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

  const commentingIsDisabled =
    addCommentIsPending || commentText.trim().length === 0;

  const anyServerError = error || addCommentResult?.error;

  return (
    <VStack action={handleAddComment} as="form" gap>
      <label
        className="text-foreground text-sm font-medium"
        htmlFor={`comment-${post.id}`}
      >
        Add a comment
      </label>
      <textarea
        className="bg-background text-foreground min-h-20 w-full rounded-md border border-gray-200 p-3 text-sm placeholder-gray-500 transition outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200 disabled:opacity-50 dark:border-neutral-800 dark:focus:border-gray-400 dark:focus:ring-gray-900"
        disabled={addCommentIsPending}
        id={`comment-${post.id}`}
        onChange={(event) => setCommentText(event.target.value)}
        onKeyDown={maybeSubmitComment}
        placeholder={
          user?.name
            ? `Share your thoughts, ${user.name}!`
            : 'Share your thoughts...'
        }
        value={commentText}
      />
      {anyServerError ? (
        <p className="text-destructive text-sm">
          {anyServerError instanceof Error
            ? anyServerError.message
            : 'Something went wrong. Please try again.'}
        </p>
      ) : null}
      <Stack end gap>
        <Button
          disabled={commentingIsDisabled}
          size="sm"
          type="submit"
          variant="secondary"
        >
          Post comment
        </Button>
      </Stack>
    </VStack>
  );
};

export function PostCard({
  detail,
  post: postRef,
}: {
  detail?: boolean;
  post: ViewRef<'Post'>;
}) {
  const post = useView(PostView, postRef);
  const author = useView(UserView, post.author);
  const category = useView(CategorySummaryView, post.category);
  const [comments, loadNext] = useListView(CommentView, post.comments);
  const tags = post.tags?.items ?? [];

  const [likeResult, likeAction, likeIsPending] = useActionState(
    fate.actions.likePost,
    null,
  );

  const [, unlikeAction, unlikeIsPending] = useActionState(
    fate.actions.unlikePost,
    null,
  );

  const [, startLikeTransition] = useTransition();
  const [, startUnlikeTransition] = useTransition();

  useEffect(() => {
    if (likeResult?.error) {
      const timeout = setTimeout(() => likeAction('reset'), 3000);
      return () => clearTimeout(timeout);
    }
  }, [likeAction, likeResult]);

  const handleLike = useCallback(
    async (options?: { error?: 'boundary' | 'callSite'; slow?: boolean }) => {
      startLikeTransition(() =>
        likeAction({
          input: { id: post.id, ...options },
          optimisticUpdate: { likes: post.likes + 1 },
          view: PostView,
        }),
      );
    },
    [likeAction, post.id, post.likes],
  );

  const handleUnlike = useCallback(async () => {
    startUnlikeTransition(async () => {
      unlikeAction({
        input: { id: post.id },
        optimisticUpdate: {
          likes: Math.max(post.likes - 1, 0),
        },
        view: PostView,
      });
    });
  }, [post.id, post.likes, unlikeAction]);

  return (
    <Card>
      <VStack gap={16}>
        <div>
          <Link to={`/post/${post.id}`}>
            <h3 className="text-lg font-semibold text-blue-700 hover:underline">
              {post.title}
            </h3>
          </Link>
          <Stack alignCenter gap={8} wrap>
            {category ? (
              <Link to={`/category/${category.id}`}>
                <span className="text-sm text-sky-700 hover:underline">
                  {category.name}
                </span>
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
          <p className="text-muted-foreground text-sm">
            by {author?.name ?? 'Unknown author'} · {post.commentCount}{' '}
            {post.commentCount === 1 ? 'comment' : 'comments'}
          </p>
        </div>
        <Stack alignCenter between={detail} end={!detail} gap>
          <Button
            disabled={likeIsPending}
            onClick={() => handleLike()}
            size="sm"
            variant="outline"
          >
            Like
          </Button>
          {detail && (
            <Button
              disabled={likeIsPending}
              onClick={() => handleLike({ slow: true })}
              size="sm"
              variant="outline"
            >
              Like (Slow)
            </Button>
          )}
          {detail && (
            <Button
              className={cx(
                'w-34 transition-colors duration-150',
                likeResult?.error
                  ? 'border-red-500 text-red-500 hover:text-red-500'
                  : '',
              )}
              disabled={likeIsPending}
              onClick={() => handleLike({ error: 'callSite' })}
              size="sm"
              variant="outline"
            >
              {likeResult?.error ? 'Oops, try again!' : `Like (Error)`}
            </Button>
          )}
          {detail && (
            <Button
              disabled={likeIsPending}
              onClick={() => handleLike({ error: 'boundary' })}
              size="sm"
              variant="outline"
            >
              Like (Major Error)
            </Button>
          )}
          {detail && (
            <Button onClick={() => handleLike()} size="sm" variant="outline">
              Like (Many)
            </Button>
          )}
          <Button
            disabled={unlikeIsPending || post.likes === 0}
            onClick={handleUnlike}
            size="sm"
            variant="outline"
          >
            Unlike
          </Button>
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
          <ErrorBoundary
            fallbackRender={({ error }) => (
              <CommentInput error={error} post={post} />
            )}
          >
            <CommentInput post={post} />
          </ErrorBoundary>
        </VStack>
      </VStack>
    </Card>
  );
}
