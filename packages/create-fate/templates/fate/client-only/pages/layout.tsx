import '../src/style.css';
import { Link } from '@void/react';
import { Suspense, type PropsWithChildren } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { FateClient } from 'react-fate';
import { getTaskClient } from '../src/state.ts';

export default function Layout({ children }: PropsWithChildren) {
  return (
    <>
      <nav aria-label="Main navigation">
        <Link href="/">Tasks</Link>
        <Link href="/about">About</Link>
      </nav>
      <main>
        <ErrorBoundary fallbackRender={({ error }) => <p role="alert">{String(error)}</p>}>
          <FateClient client={getTaskClient()}>
            <Suspense fallback={<p>Restoring tasks…</p>}>{children}</Suspense>
          </FateClient>
        </ErrorBoundary>
      </main>
    </>
  );
}
