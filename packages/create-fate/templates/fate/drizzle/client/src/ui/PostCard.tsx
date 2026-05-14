import type { Comment as InlineComment, Post } from '@app/server/src/router.ts';
import Stack, { VStack } from '@nkzw/stack';
import { cx } from 'class-variance-authority';
import { fbs } from 'fbtee';
import {
  KeyboardEvent,
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useFateClient, useLiveListView, useLiveView, useView, view, ViewRef } from 'react-fate';
import { Button } from '../ui/Button.tsx';
import Card from '../ui/Card.tsx';
import AuthClient from '../user/AuthClient.tsx';
import CommentCard, { CommentView } from './CommentCard.tsx';
import H3 from './H3.tsx';
import Link from './Link.tsx';
import { UserView } from './UserCard.tsx';

const CommentConnectionView = {
  args: { first: 3 },
  items: {
    node: CommentView,
  },
  live: {
    append: 'visible',
  },
};

export const PostView = view<Post>()({
  author: UserView,
  commentCount: true,
  comments: CommentConnectionView,
  content: true,
  id: true,
  likes: true,
  title: true,
});

const CommentInput = ({
  error,
  post,
}: {
  error?: unknown;
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
      <span className="text-sm font-medium text-foreground">
        <fbt desc="Comment add label">Add a comment</fbt>
      </span>
      <textarea
        className="squircle min-h-20 w-full border border-gray-200/80 bg-gray-100/50 p-3 text-sm placeholder-gray-500 transition outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200 disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900/40 dark:placeholder-gray-400"
        disabled={addCommentIsPending}
        onChange={(event) => setCommentText(event.target.value)}
        onKeyDown={maybeSubmitComment}
        placeholder={fbs('Share your thoughts...', 'Placeholder text for comment input')}
        value={commentText}
      />
      {anyServerError ? (
        <p className="text-sm text-destructive">
          {anyServerError instanceof Error ? (
            anyServerError.message
          ) : (
            <fbt desc="Error text">Something went wrong. Please try again.</fbt>
          )}
        </p>
      ) : null}
      <Stack end gap>
        <Button disabled={commentingIsDisabled} size="sm" type="submit" variant="secondary">
          <fbt desc="Post comment button">Post comment</fbt>
        </Button>
      </Stack>
    </VStack>
  );
};

export function PostCard({ detail, post: postRef }: { detail?: boolean; post: ViewRef<'Post'> }) {
  const fate = useFateClient();
  const post = useLiveView(PostView, postRef);
  const author = useView(UserView, post.author);
  const [comments, loadNext] = useLiveListView(CommentConnectionView, post.comments);

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
          </VStack>
          <Stack alignCenter gap={12} wrap>
            <Stack
              alignCenter
              className="squircle bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 dark:bg-neutral-800 dark:text-white"
              gap
            >
              <span>👍</span>
              <span>
                <fbt desc="Like count">
                  <fbt:plural count={post.likes} many="Likes" showCount="yes">
                    Like
                  </fbt:plural>
                </fbt>
              </span>
            </Stack>
            <Button action={handleLike} disabled={likeIsPending} size="sm" variant="outline">
              <fbt desc="Like button">Like</fbt>
            </Button>
            {detail && (
              <Button
                action={() => handleLike({ slow: true })}
                disabled={likeIsPending}
                size="sm"
                variant="outline"
              >
                <fbt desc="Like button with a slow request">Like (Slow)</fbt>
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
                {likeResult?.error ? (
                  <fbt desc="Very short error messages">Oops, try again!</fbt>
                ) : (
                  <fbt desc="Like button that triggers an error">Like (Error)</fbt>
                )}
              </Button>
            )}
            {detail && (
              <Button
                action={() => handleLike({ error: 'boundary' })}
                disabled={likeIsPending}
                size="sm"
                variant="outline"
              >
                <fbt desc="Like button that triggers a network error">Like (Network Error)</fbt>
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
                <fbt desc="Like button that can be pressed many times">Like (Many)</fbt>
              </Button>
            )}
            <Button
              action={handleUnlike}
              disabled={unlikeIsPending || post.likes === 0}
              size="sm"
              variant="outline"
            >
              <fbt desc="Unlike button">Unlike</fbt>
            </Button>
          </Stack>
        </Stack>
        <p className="text-sm leading-relaxed text-foreground/90 lg:text-base">{post.content}</p>
        <p className="text-sm text-muted-foreground">- {author?.name ?? 'Unknown author'}</p>
        <VStack gap={16}>
          <h4 className="text-base font-semibold text-foreground">
            <fbt desc="Comment headline">
              <fbt:plural count={post.commentCount} many="Comments" showCount="ifMany">
                One Comment
              </fbt:plural>
            </fbt>
          </h4>
          {comments.length > 0 ? (
            <VStack gap={12}>
              {comments.map(({ node }) => (
                <CommentCard comment={node} key={node.id} post={post} />
              ))}
              {loadNext ? (
                <Button onClick={loadNext} variant="ghost">
                  <fbt desc="Load more comments button">Load more comments</fbt>
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
