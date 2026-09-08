import { useLocaleContext } from 'fbtee';
import { startTransition } from 'react';
import AvailableLanguages from '../lib/AvailableLanguages.tsx';

export default function LocaleSwitcher() {
  const { locale, localeChangeIsPending, setLocale } = useLocaleContext();
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="sr-only">
        <fbt desc="Locale switcher button">Change Language</fbt>
      </span>
      <select
        className="rounded-md border border-gray-300 bg-background px-2 py-1 text-foreground"
        disabled={localeChangeIsPending}
        onChange={(event) => {
          const nextLocale = event.target.value;
          try {
            localStorage.setItem('fbtee:locale', nextLocale);
          } catch {
            // Changing the language still works without browser storage.
          }
          startTransition(() => setLocale(nextLocale));
        }}
        value={locale}
      >
        {[...AvailableLanguages].map(([value, name]) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
