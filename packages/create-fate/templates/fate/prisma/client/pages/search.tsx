import type { Comment, Post } from '@app/server/src/trpc/views.ts';
import Stack, { VStack } from '@nkzw/stack';
import { fbs } from 'fbtee';
import { Suspense, useDeferredValue, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useRequest, useView, view, ViewRef } from 'react-fate';
import cx from '../src/lib/cx.tsx';
import Card from '../src/ui/Card.tsx';
import CommentCard, { CommentView } from '../src/ui/CommentCard.tsx';
import Error from '../src/ui/Error.tsx';
import Input from '../src/ui/Input.tsx';
import Section from '../src/ui/Section.tsx';

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

const CommentResult = ({ comment: commentRef }: { comment: ViewRef<'Comment'> }) => {
  const comment = useView(CommentSearchView, commentRef);
  const post = useView(CommentPostView, comment.post);

  return <CommentCard comment={comment} link post={post} />;
};

const SearchResults = ({ isStale, query }: { isStale: boolean; query: string }) => {
  const { commentSearch } = useRequest({
    commentSearch: { args: { query }, list: CommentSearchView },
  });

  if (commentSearch.length === 0) {
    return (
      <p>
        <fbt desc="No matches text">
          No matches for{' '}
          <i>
            &quot;<fbt:param name="query">{query}</fbt:param>&quot;
          </i>
        </fbt>
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

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;

  return (
    <Section>
      <Card>
        <Stack alignCenter between gap={16}>
          <Input
            className="w-64"
            onChange={(e) => setQuery(e.target.value)}
            placeholder={fbs('Search comments...', 'Search input placeholder')}
            ref={(ref) => ref?.focus()}
            value={query}
          />
          <div className="text-xs text-muted-foreground">
            <fbt desc="Slowdown label explanation">500ms artificial slowdown</fbt>
          </div>
        </Stack>

        <ErrorBoundary FallbackComponent={Error}>
          <Suspense
            fallback={
              <h2>
                <fbt desc="Text for thinking/loading screen">Thinking…</fbt>
              </h2>
            }
          >
            {query.trim().length > 0 ? <SearchResults isStale={isStale} query={query} /> : null}
          </Suspense>
        </ErrorBoundary>
      </Card>
    </Section>
  );
}
