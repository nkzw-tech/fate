import { InputHTMLAttributes, Ref } from 'react';
import cx from '../lib/cx.tsx';

export default function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      className={cx(
        'border-input squircle flex w-32 border bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 focus-visible:ring-offset-background focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-900/40',
        className,
      )}
      {...props}
    />
  );
}
