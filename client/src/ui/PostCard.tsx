import type {
  Category,
  Comment,
  Post,
} from '@nkzw/fate-server/src/trpc/router.ts';
import Stack, { VStack } from '@nkzw/stack';
import { cx } from 'class-variance-authority';
import { X } from 'lucide-react';
import {
  KeyboardEvent,
  useCallback,
  useEffect,
  useState,
  useTransition,
} from 'react';
import { useListView, useView, view, ViewRef } from 'react-fate';
import { Link } from 'react-router';
import { fate } from '../lib/fate.tsx';
import { Button } from '../ui/Button.tsx';
import Card from '../ui/Card.tsx';
import TagBadge, { TagView } from '../ui/TagBadge.tsx';
import AuthClient from '../user/AuthClient.tsx';
import { UserView } from './UserCard.tsx';

const CommentView = view<Comment>()({
  author: {
    id: true,
    name: true,
    username: true,
  },
  content: true,
  id: true,
});

const Comment = ({
  comment: commentRef,
  post,
}: {
  comment: ViewRef<'Comment'>;
  post: { commentCount: number; id: string };
}) => {
  const comment = useView(CommentView, commentRef);
  const { author } = comment;

  return (
    <div
      className="group rounded-md border border-gray-200/80 bg-gray-50/70 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900/40"
      key={comment.id}
    >
      <Stack between gap={16}>
        <p className="font-medium text-gray-900 dark:text-gray-200">
          {author?.name ?? 'Anonymous'}
        </p>
        <Button
          className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
          onClick={async () => {
            await fate.mutations.deleteComment({
              deleteRecord: true,
              input: { id: comment.id },
              optimisticUpdate: {
                post: { commentCount: post.commentCount - 1, id: post.id },
              },
              view: view<Comment>()({
                id: true,
                post: { commentCount: true },
              }),
            });
          }}
          size="sm"
          variant="ghost"
        >
          <X size={14} />
        </Button>
      </Stack>
      <p className="text-foreground/80">{comment.content}</p>
    </div>
  );
};

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

export function PostCard({
  detail,
  post: postRef,
}: {
  detail?: boolean;
  post: ViewRef<'Post'>;
}) {
  const { data: session } = AuthClient.useSession();
  const user = session?.user;

  const post = useView(PostView, postRef);
  const author = useView(UserView, post.author);
  const category = useView(CategorySummaryView, post.category);
  const [comments, loadNext] = useListView(CommentView, post.comments);
  const tags = post.tags?.items ?? [];

  const [commentText, setCommentText] = useState('');

  const [likeIsPending, startLikeTransition] = useTransition();
  const [unlikeIsPending, startUnlikeTransition] = useTransition();
  const [addCommentIsPending, startAddCommentTransition] = useTransition();
  const [addCommentError, setAddCommentError] = useState<unknown>(null);
  const [likeError, setLikeError] = useState<Error | null>(null);

  useEffect(() => {
    if (likeError) {
      const timer = setTimeout(() => {
        setLikeError(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [likeError]);

  const handleLike = useCallback(
    async (options?: { error?: 'boundary' | 'callSite'; slow?: boolean }) => {
      startLikeTransition(async () => {
        const { error } = await fate.mutations.likePost({
          input: { id: post.id, ...options },
          optimisticUpdate: { likes: post.likes + 1 },
          view: PostView,
        });
        if (error) {
          setLikeError(error);
        }
      });
    },
    [post.id, post.likes],
  );

  const handleUnlike = useCallback(async () => {
    startUnlikeTransition(async () => {
      await fate.mutations.unlikePost({
        input: { id: post.id },
        optimisticUpdate: {
          likes: Math.max(post.likes - 1, 0),
        },
        view: PostView,
      });
    });
  }, [post.id, post.likes]);

  const handleAddComment = async (event: { preventDefault: () => void }) => {
    event.preventDefault();

    const content = commentText.trim();

    setAddCommentError(null);
    startAddCommentTransition(async () => {
      if (!content || !user?.id) {
        return;
      }

      try {
        await fate.mutations.addComment({
          input: { content, postId: post.id },
          optimisticUpdate: {
            author: {
              id: user.id,
              name: user.name ?? 'Anonymous',
            },
            content,
            id: `optimistic:${Date.now().toString(36)}`,
            post: { commentCount: post.commentCount + 1, id: post.id },
          },
          view: view<Comment>()({
            ...CommentView,
            post: { commentCount: true },
          }),
        });
      } catch (error) {
        setAddCommentError(error);
        return;
      }

      setCommentText('');
    });
  };

  const maybeSubmitComment = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      handleAddComment(event);
    }
  };

  const commentingIsDisabled =
    addCommentIsPending || commentText.trim().length === 0;

  return (
    <Card>
      <VStack gap={16}>
        <Stack between gap={16}>
          <div>
            <Link to={`/post/${post.id}`}>
              <h3 className="text-foreground text-lg font-semibold">
                {post.title}
              </h3>
            </Link>
            <Stack alignCenter gap={8} wrap>
              {category ? (
                <span className="text-muted-foreground text-sm">
                  {category.name}
                </span>
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
          <Stack alignCenter gap>
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
                  'w-24',
                  likeError ? 'text-red-500 hover:text-red-500' : '',
                )}
                disabled={likeIsPending}
                onClick={() => handleLike({ error: 'callSite' })}
                size="sm"
                variant="outline"
              >
                {likeError ? 'Oops!' : `Like (Error)`}
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
              {comments.map(({ node }) => (
                <Comment comment={node} key={node.id} post={post} />
              ))}
              {loadNext ? (
                <Button onClick={loadNext} variant="ghost">
                  Load more comments
                </Button>
              ) : null}
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
            {addCommentError ? (
              <p className="text-destructive text-sm">
                {addCommentError instanceof Error
                  ? addCommentError.message
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
        </VStack>
      </VStack>
    </Card>
  );
}
