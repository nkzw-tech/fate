import type { Comment, Post } from '@nkzw/fate-server/src/trpc/views.ts';
import { Suspense, useRequest, useView, view, ViewRef } from 'preact-fate';
import { useEffect, useState } from 'preact/hooks';
import cx from '../lib/cx.ts';
import Card from '../ui/Card.tsx';
import CommentCard, { CommentView } from '../ui/CommentCard.tsx';
import Error from '../ui/Error.tsx';
import ErrorBoundary from '../ui/ErrorBoundary.tsx';
import Input from '../ui/Input.tsx';
import Section from '../ui/Section.tsx';
import Stack, { VStack } from '../ui/Stack.tsx';

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

const isDevelopment = import.meta.env.DEV;

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

// Stand-in for React's `useDeferredValue(query)`: React renders the new query
// in the background and only commits it once that render no longer suspends.
// This renders the same request in its own empty <Suspense> boundary and
// reports the query once its data is ready.
const DeferredSearch = ({
  onReady,
  query,
}: {
  onReady: (query: string) => void;
  query: string;
}) => {
  useRequest({
    commentSearch: { args: { query }, list: CommentSearchView },
  });

  useEffect(() => onReady(query), [onReady, query]);

  return null;
};

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [deferredQuery, setDeferredQuery] = useState(query);
  const isStale = query !== deferredQuery;

  return (
    <Section>
      <Card>
        <Stack alignCenter between gap={16}>
          <Input
            className="w-64"
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search comments..."
            ref={(ref) => ref?.focus()}
            value={query}
          />
          {isDevelopment ? (
            <div className="text-xs text-muted-foreground">500ms artificial slowdown</div>
          ) : null}
        </Stack>

        <ErrorBoundary FallbackComponent={Error}>
          <Suspense fallback={<h2>Thinking…</h2>}>
            {query.trim().length > 0 ? <SearchResults isStale={isStale} query={query} /> : null}
          </Suspense>
          {isStale && query.trim().length > 0 ? (
            <Suspense>
              <DeferredSearch key={query} onReady={setDeferredQuery} query={query} />
            </Suspense>
          ) : null}
        </ErrorBoundary>
      </Card>
    </Section>
  );
}
