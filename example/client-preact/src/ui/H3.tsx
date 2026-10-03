import type { ComponentChildren } from 'preact';
import cx from '../lib/cx.ts';

export default function H2({
  children,
  className,
}: {
  children: ComponentChildren;
  className?: string;
}) {
  return (
    <h3
      className={cx(
        'bg-linear-to-r from-slate-900 to-slate-600 bg-clip-text text-lg font-semibold tracking-widest text-transparent uppercase opacity-100 transition duration-150 hover:opacity-70 active:translate-y-[1.5px] dark:from-white dark:to-slate-200',
        className,
      )}
    >
      {children}
    </h3>
  );
}
