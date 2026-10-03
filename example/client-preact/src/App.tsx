import { httpBatchLink } from '@trpc/client';
import { createContext, type ComponentChildren, type ComponentType } from 'preact';
import { FateClient, Suspense } from 'preact-fate';
import { createFateClient } from 'preact-fate/client';
import { Route, Router } from 'preact-iso/router';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import env from './lib/env.ts';
import CategoryPage from './pages/CategoryPage.tsx';
import HomePage from './pages/HomePage.tsx';
import LoginPage from './pages/LoginPage.tsx';
import PostPage from './pages/PostPage.tsx';
import SearchPage from './pages/SearchPage.tsx';
import Card from './ui/Card.tsx';
import Error from './ui/Error.tsx';
import ErrorBoundary from './ui/ErrorBoundary.tsx';
import Header from './ui/Header.tsx';
import Section from './ui/Section.tsx';
import Thinking from './ui/Thinking.tsx';
import AuthClient from './user/AuthClient.ts';

export default function Layout({ children }: { children: ComponentChildren }) {
  const { data: session, isPending } = AuthClient.useSession();
  const userId = session?.user.id;

  const fate = useMemo(() => {
    const credentialFetch = userId
      ? (input: string | URL | Request, init?: RequestInit) =>
          fetch(input, {
            ...init,
            credentials: 'include',
          })
      : undefined;

    return createFateClient({
      ...(credentialFetch ? { fetch: credentialFetch } : null),
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
      liveUrl: `${env('SERVER_URL')}/fate`,
    });
  }, [userId]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="min-h-screen bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_80%_0,rgba(99,102,241,0.08),transparent_28%)]">
        <Header />
        {isPending ? (
          <Thinking />
        ) : (
          <FateClient client={fate} key={userId}>
            <ErrorBoundary
              fallbackRender={({ error }) => (
                <Section>
                  <Card>
                    <Error error={error} />
                  </Card>
                </Section>
              )}
            >
              <Suspense fallback={<Thinking />}>{children}</Suspense>
            </ErrorBoundary>
          </FateClient>
        )}
      </div>
    </div>
  );
}

/**
 * preact-iso's `<Router>` is itself a suspense boundary for route content: it
 * keeps the previous route on screen while the next one suspends, like void's
 * navigations, which run in a transition. Its first route has nothing to keep
 * on screen (the Router would render nothing), so the first page rendered by
 * each <Routes> gets its own <Suspense> with the layout's "Thinking..."
 * fallback instead.
 */
const RouterState = createContext<{
  hasMountedRoute: () => boolean;
  markRouteMounted: () => void;
}>({
  hasMountedRoute: () => false,
  markRouteMounted: () => {},
});

const page = <Props extends object>(Component: ComponentType<Props>) => {
  function Page(props: Props) {
    const { hasMountedRoute, markRouteMounted } = useContext(RouterState);
    const [isFirstRoute] = useState(() => !hasMountedRoute());

    useEffect(markRouteMounted, [markRouteMounted]);

    return isFirstRoute ? (
      <Suspense fallback={<Thinking />}>
        <Component {...props} />
      </Suspense>
    ) : (
      <Component {...props} />
    );
  }

  Page.displayName = `Page(${Component.displayName || Component.name})`;
  return Page;
};

const Pages = {
  Category: page(CategoryPage),
  Home: page(HomePage),
  Login: page(LoginPage),
  Post: page(PostPage),
  Search: page(SearchPage),
};

export function Routes() {
  const mountedRoute = useRef(false);
  const state = useMemo(
    () => ({
      hasMountedRoute: () => mountedRoute.current,
      markRouteMounted: () => {
        mountedRoute.current = true;
      },
    }),
    [],
  );

  return (
    <RouterState.Provider value={state}>
      <Router>
        <Route component={Pages.Home} path="/" />
        <Route component={Pages.Post} path="/post/:id" />
        <Route component={Pages.Category} path="/category/:id" />
        <Route component={Pages.Search} path="/search" />
        <Route component={Pages.Login} path="/login" />
        <Route component={Pages.Home} default />
      </Router>
    </RouterState.Provider>
  );
}
