/// <reference types="fbtee/ReactTypes.d.ts" />

import { createLocaleContext, useLocaleContext } from 'fbtee';
import { ReactNode, startTransition, useEffect, useState } from 'react';
import AvailableLanguages from './AvailableLanguages.tsx';

const Context = createLocaleContext({
  availableLanguages: AvailableLanguages,
  // Keep the server and first client render identical; restore preferences after hydration.
  clientLocales: ['en-US'],
  fallbackLocale: 'en-US',
  loadLocale: async (locale) => {
    if (locale !== 'en-US' && AvailableLanguages.has(locale)) {
      return (await import(`../translations/${locale}.json`)).default[locale];
    }
    return {};
  },
});

function RestoreLocale({ restored, onRestore }: { restored: boolean; onRestore: () => void }) {
  const { locale, setLocale } = useLocaleContext();
  useEffect(() => {
    if (restored) return;
    onRestore();
    let savedLocale: string | null = null;
    try {
      savedLocale = localStorage.getItem('fbtee:locale');
    } catch {
      // Browser storage can be unavailable.
    }
    const preferred = [savedLocale, ...navigator.languages, navigator.language]
      .filter((value): value is string => !!value)
      .map((value) => value.replaceAll('_', '-'));
    const nextLocale = preferred
      .map((value) =>
        AvailableLanguages.has(value)
          ? value
          : [...AvailableLanguages.keys()].find(
              (available) => available.split('-')[0] === value.split('-')[0],
            ),
      )
      .find(Boolean);
    if (nextLocale && nextLocale !== locale) {
      startTransition(() => setLocale(nextLocale));
    }
  }, [locale, setLocale, restored, onRestore]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}

export default function LocaleContext({ children }: { children: ReactNode }) {
  const [restored, setRestored] = useState(false);
  return (
    <Context>
      <RestoreLocale restored={restored} onRestore={() => setRestored(true)} />
      {children}
    </Context>
  );
}
