import type { Comment, Post } from '@nkzw/fate-server/src/trpc/views.ts';
import Stack, { VStack } from '@nkzw/stack';
import { Suspense, useDeferredValue, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useRequest, useView, view, ViewRef } from 'react-fate';
import cx from '../lib/cx.tsx';
import Card from './Card.tsx';
import CommentCard, { CommentView } from './CommentCard.tsx';
import Error from './Error.tsx';
import Input from './Input.tsx';

const CommentPostView = view<Post>()({
  commentCount: true,
  id: true,
  title: true,
});

const CommentSearchView = view<Comment>()({
  ...CommentView,
  id: true,
  post: CommentPostView,
});

const CommentResult = ({
  comment: commentRef,
}: {
  comment: ViewRef<'Comment'>;
}) => {
  const comment = useView(CommentSearchView, commentRef);
  const post = useView(CommentPostView, comment.post);

  return <CommentCard comment={comment} link post={post} />;
};

const SearchResults = ({
  isStale,
  query,
}: {
  isStale: boolean;
  query: string;
}) => {
  const { commentSearch } = useRequest({
    commentSearch: {
      args: { query },
      root: CommentSearchView,
      type: 'Comment',
    },
  } as const);

  if (commentSearch.length === 0) {
    return (
      <p>
        No matches for <i>&quot;{query}&quot;</i>
      </p>
    );
  }

  return (
    <VStack className={cx(isStale && 'opacity-50')} gap={12}>
      {commentSearch.map((comment) => (
        <CommentResult comment={comment} key={comment.id} />
      ))}
    </VStack>
  );
};

export default function Search() {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;

  return (
    <Card>
      <Stack alignCenter between gap={16}>
        <Input
          className="w-64"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search comments..."
          ref={(ref) => ref?.focus()}
          value={query}
        />
        <div className="text-muted-foreground text-xs">
          500ms artificial slowdown
        </div>
      </Stack>

      <ErrorBoundary FallbackComponent={Error}>
        <Suspense fallback={<h2>Thinking…</h2>}>
          {query.trim().length > 0 ? (
            <SearchResults isStale={isStale} query={query} />
          ) : null}
        </Suspense>
      </ErrorBoundary>
    </Card>
  );
}
