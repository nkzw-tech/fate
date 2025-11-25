import type { Comment } from '@nkzw/fate-server/src/trpc/views.ts';
import Stack from '@nkzw/stack';
import { X } from 'lucide-react';
import { useView, view, ViewRef } from 'react-fate';
import { Link } from 'react-router';
import { fate } from '../lib/fate.tsx';
import { Button } from './Button.tsx';

export const CommentView = view<Comment>()({
  author: {
    id: true,
    name: true,
    username: true,
  },
  content: true,
  id: true,
});

export const CommentViewWithPostCount = view<Comment>()({
  ...CommentView,
  post: { commentCount: true },
});

export default function CommentCard({
  comment: commentRef,
  link,
  post,
}: {
  comment: ViewRef<'Comment'>;
  link?: boolean;
  post: { commentCount: number; id: string; title: string };
}) {
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
      {link && (
        <Link className="text-sky-700 hover:underline" to={`/post/${post.id}`}>
          {post.title}
        </Link>
      )}
    </div>
  );
}
