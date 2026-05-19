import '../src/App.css';
import { ReactNode, Suspense, useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { FateClient } from 'react-fate';
import { createFateClient } from 'react-fate/client';

const graphQLURL = import.meta.env.VITE_GRAPHQL_URL;
const graphQLLiveURL = import.meta.env.VITE_GRAPHQL_LIVE_URL;

const Loading = () => (
  <main className="mx-auto flex min-h-screen max-w-4xl items-center px-6 py-16 text-slate-500">
    Loading...
  </main>
);

export default function Layout({ children }: { children: ReactNode }) {
  const fate = useMemo(
    () =>
      createFateClient({
        live: graphQLLiveURL ? { url: graphQLLiveURL } : false,
        url: graphQLURL,
      }),
    [],
  );

  return (
    <FateClient client={fate}>
      <ErrorBoundary
        fallbackRender={({ error }) => (
          <main className="mx-auto min-h-screen max-w-4xl px-6 py-16">
            <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-950 dark:border-red-900 dark:bg-red-950 dark:text-red-50">
              {error instanceof Error ? error.message : String(error)}
            </div>
          </main>
        )}
      >
        <Suspense fallback={<Loading />}>{children}</Suspense>
      </ErrorBoundary>
    </FateClient>
  );
}
