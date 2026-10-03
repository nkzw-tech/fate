import type { InputHTMLAttributes, JSX } from 'preact';
import cx from '../lib/cx.ts';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  className?: string;
};

// Note: Preact's `onChange` is the native `change` event (fired on blur for
// text fields). Text inputs use `onInput` to update on every keystroke like
// React's `onChange`.
export default function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cx(
        'border-input squircle flex w-32 border bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 focus-visible:ring-offset-background focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-900/40',
        className,
      )}
      // Preact types `<input>` props as a union keyed on `type` and `role`.
      {...(props as JSX.IntrinsicElements['input'])}
    />
  );
}

export function CheckBox({ className, ...props }: InputProps) {
  return (
    <Input
      className={cx(
        "duration-150ms relative h-6 w-6 shrink-0 cursor-pointer appearance-none p-0 after:absolute after:inset-0.5 after:h-4.5 after:w-4.5 after:rounded-4xl after:bg-foreground/60 after:opacity-0 after:transition-opacity after:content-[''] after:[corner-shape:squircle] checked:border-foreground/50 checked:after:block checked:after:opacity-100 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      type="checkbox"
      {...props}
    />
  );
}
