/// <reference types="fbtee/ReactTypes.d.ts" />

import '../src/App.css';
import Stack from '@nkzw/stack';
import { httpBatchLink } from '@trpc/client';
import { createLocaleContext } from 'fbtee';
import { ReactNode, Suspense, useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { FateClient } from 'react-fate';
import { createFateClient } from 'react-fate/client';
import AvailableLanguages from '../src/lib/AvailableLanguages.tsx';
import env from '../src/lib/env.tsx';
import Card from '../src/ui/Card.tsx';
import Error from '../src/ui/Error.tsx';
import Header from '../src/ui/Header.tsx';
import Section from '../src/ui/Section.tsx';
import AuthClient from '../src/user/AuthClient.tsx';

const Thinking = () => (
  <Section>
    <Stack center className="animate-pulse text-gray-500 italic" verticalPadding={48}>
      <fbt desc="Text for thinking/loading screen">Thinking...</fbt>
    </Stack>
  </Section>
);

const LocaleContext = createLocaleContext({
  availableLanguages: AvailableLanguages,
  clientLocales: [navigator.language, ...navigator.languages],
  loadLocale: async (locale: string) => {
    if (locale !== 'en_US' && AvailableLanguages.has(locale)) {
      return (await import(`../src/translations/${locale}.json`)).default[locale];
    }

    return {};
  },
});

export default function Layout({ children }: { children: ReactNode }) {
  const { data: session, isPending } = AuthClient.useSession();
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
        liveUrl: `${env('SERVER_URL')}/fate`,
        ...(userId
          ? {
              fetch: (input: RequestInfo | URL, init?: RequestInit) =>
                fetch(input, {
                  ...init,
                  credentials: 'include',
                }),
            }
          : null),
      }),
    [userId],
  );

  if (isPending) {
    return (
      <LocaleContext>
        <div className="min-h-screen bg-background text-foreground">
          <div className="min-h-screen bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_80%_0,rgba(99,102,241,0.08),transparent_28%)]">
            <Thinking />
          </div>
        </div>
      </LocaleContext>
    );
  }

  return (
    <LocaleContext>
      <FateClient client={fate} key={userId}>
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
              <Suspense fallback={<Thinking />}>{children}</Suspense>
            </ErrorBoundary>
          </div>
        </div>
      </FateClient>
    </LocaleContext>
  );
}
