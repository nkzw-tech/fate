import './App.css';
import Stack from '@nkzw/stack';
import { httpBatchLink, httpSubscriptionLink, splitLink } from '@trpc/client';
import { StrictMode, Suspense, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from 'react-error-boundary';
import { FateClient } from 'react-fate';
import { createFateClient } from 'react-fate/client';
import { BrowserRouter, Route, Routes } from 'react-router';
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

const Thinking = () => (
  <Section>
    <Stack center className="animate-pulse text-gray-500 italic" verticalPadding={48}>
      Thinking…
    </Stack>
  </Section>
);

const App = () => {
  const { data: session, isPending } = AuthClient.useSession();
  const userId = session?.user.id;

  const fate = useMemo(
    () =>
      createFateClient({
        links: [
          splitLink({
            condition: (operation) => operation.type === 'subscription',
            false: httpBatchLink({
              fetch: (input, init) =>
                fetch(input, {
                  ...init,
                  credentials: userId ? 'include' : undefined,
                }),
              url: `${env('SERVER_URL')}/trpc`,
            }),
            true: httpSubscriptionLink({
              eventSourceOptions: {
                withCredentials: Boolean(userId),
              },
              url: `${env('SERVER_URL')}/trpc`,
            }),
          }),
        ],
      }),
    [userId],
  );

  if (isPending) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="min-h-screen bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_80%_0,rgba(99,102,241,0.08),transparent_28%)]">
          <Thinking />
        </div>
      </div>
    );
  }

  return (
    <FateClient client={fate} key={userId}>
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
              <Suspense fallback={<Thinking />}>
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
