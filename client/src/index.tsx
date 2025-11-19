import './App.css';
import Stack from '@nkzw/stack';
import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from 'react-error-boundary';
import { FateClient } from 'react-fate';
import { BrowserRouter, Outlet, Route, Routes } from 'react-router';
import { fate } from './lib/fate.tsx';
import CategoryRoute from './routes/CategoryRoute.tsx';
import HomeRoute from './routes/HomeRoute.tsx';
import PostRoute from './routes/PostRoute.tsx';
import SignInRoute from './routes/SignInRoute.tsx';
import Card from './ui/Card.tsx';
import Header from './ui/Header.tsx';
import Section from './ui/Section.tsx';

const Layout = () => {
  return (
    <>
      <Outlet />
    </>
  );
};

const App = () => {
  return (
    <div className="bg-background min-h-screen">
      <div className="min-h-[calc(100vh-206px)]">
        <Header />
        <ErrorBoundary
          fallbackRender={({ error }) => (
            <Section>
              <Card>
                <h3 className="text-xl font-semibold text-red-700">Error</h3>
                <code>{error.stack || `Fate Error: ${error.message}`}</code>

                <a
                  className="block cursor-pointer underline"
                  onClick={() => window.location.reload()}
                >
                  Try again
                </a>
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
                  Thinking...
                </Stack>
              </Section>
            }
          >
            <Routes>
              <Route element={<Layout />}>
                <Route element={<HomeRoute />} path="/" />
                <Route element={<PostRoute />} path="/post/:id" />
                <Route element={<CategoryRoute />} path="/category/:id" />
                <Route element={<SignInRoute />} path="/login" />
              </Route>
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FateClient client={fate}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </FateClient>
  </StrictMode>,
);
