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
    <h2 className={cx('text-2xl font-semibold text-gray-900 dark:text-gray-50', className)}>
      {children}
    </h2>
  );
}
