import './App.css';
import Stack from '@nkzw/stack';
import { httpBatchLink } from '@trpc/client';
import { StrictMode, Suspense, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from 'react-error-boundary';
import { FateClient } from 'react-fate';
import { BrowserRouter, Route, Routes } from 'react-router';
import { createFateClient } from './fate.ts';
import env from './lib/env.tsx';
import CategoryRoute from './routes/CategoryRoute.tsx';
import HomeRoute from './routes/HomeRoute.tsx';
import PostRoute from './routes/PostRoute.tsx';
import SearchRoute from './routes/SearchRoute.tsx';
import SignInRoute from './routes/SignInRoute.tsx';
import Card from './ui/Card.tsx';
import Error from './ui/Error.tsx';
import Header from './ui/Header.tsx';
import Section from './ui/Section.tsx';
import AuthClient from './user/AuthClient.tsx';

const App = () => {
  const { data: session } = AuthClient.useSession();
  const userId = session?.user.id;

  const fate = useMemo(
    () =>
      createFateClient({
        links: [
          httpBatchLink({
            fetch: (input, init) =>
              fetch(input, {
                ...init,
                credentials: userId ? 'include' : undefined,
              }),
            url: `${env('SERVER_URL')}/trpc`,
          }),
        ],
      }),
    [userId],
  );

  return (
    <FateClient client={fate} key={userId || 'anonymous'}>
      <BrowserRouter>
        <div className="min-h-screen bg-background text-foreground">
          <div className="min-h-screen bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_80%_0,rgba(99,102,241,0.08),transparent_28%)]">
            <Header />
            <ErrorBoundary
              fallbackRender={({ error }) => (
                <Section>
                  <Card>
                    <Error error={error} />
                  </Card>
                </Section>
              )}
            >
              <Suspense
                fallback={
                  <Section>
                    <Stack
                      center
                      className="animate-pulse text-gray-500 italic"
                      verticalPadding={48}
                    >
                      Thinking…
                    </Stack>
                  </Section>
                }
              >
                <Routes>
                  <Route element={<HomeRoute />} path="/" />
                  <Route element={<PostRoute />} path="/post/:id" />
                  <Route element={<CategoryRoute />} path="/category/:id" />
                  <Route element={<SearchRoute />} path="/search" />
                  <Route element={<SignInRoute />} path="/login" />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      </BrowserRouter>
    </FateClient>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
