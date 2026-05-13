import { VStack } from '@nkzw/stack';
import { cx } from 'class-variance-authority';
import { useLocaleContext } from 'fbtee';
import { Languages } from 'lucide-react';
import AvailableLanguages from '../lib/AvailableLanguages.tsx';
import { Button } from './Button.tsx';
import Card from './Card.tsx';

export default function LocaleSwitcher() {
  const { locale: currentLocale, setLocale } = useLocaleContext();

  return (
    <>
      <Button asChild size="sm" variant="ghost">
        <button popoverTarget="locale-switcher" popoverTargetAction="show">
          <Languages className="h-4 w-4" />
          <span className="hidden sm:inline">
            <fbt desc="Locale switcher button">Change Language</fbt>
          </span>
        </button>
      </Button>
      <Card
        className="translate-y-50 justify-self-center border-slate-100 bg-white shadow transition-all dark:bg-black"
        id="locale-switcher"
        popover="auto"
      >
        <VStack alignCenter center className="w-64" gap={12} padding={16}>
          {[...AvailableLanguages.entries()].map(([locale, name]) => (
            <Button
              action={() => {
                setLocale(locale);
                localStorage.setItem('fbtee:locale', locale);
              }}
              asChild
              className={cx(
                'transition-background border-slate-200 bg-transparent duration-150 hover:border-slate-300 hover:bg-slate-200 dark:hover:bg-slate-900 dark:text-white active:py-2',
                {
                  'bg-slate-100 dark:bg-slate-900': currentLocale === locale,
                },
              )}
              key={locale}
              size="sm"
              variant="outline"
            >
              <a className="w-full flex-1 cursor-pointer p-2">{name}</a>
            </Button>
          ))}
        </VStack>
      </Card>
    </>
  );
}
