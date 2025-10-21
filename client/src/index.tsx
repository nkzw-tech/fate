import './App.css';
import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from 'react-error-boundary';
import { FateClient } from 'react-fate';
import { BrowserRouter, Outlet, Route, Routes } from 'react-router';
import { fate } from './lib/trpc.tsx';
import HomeRoute from './routes/HomeRoute.tsx';
import SignInRoute from './routes/SignInRoute.tsx';
import Header from './ui/Header.tsx';

const Layout = () => {
  return (
    <>
      <Header />
      <Outlet />
    </>
  );
};

const App = () => {
  return (
    <div className="bg-background min-h-screen">
      <ErrorBoundary fallbackRender={() => null}>
        <div className="min-h-[calc(100vh-206px)]">
          <Suspense>
            <Routes>
              <Route element={<Layout />}>
                <Route element={<HomeRoute />} path="/" />
                <Route element={<SignInRoute />} path="/login" />
              </Route>
            </Routes>
          </Suspense>
        </div>
      </ErrorBoundary>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense>
      <FateClient client={fate}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </FateClient>
    </Suspense>
  </StrictMode>,
);
