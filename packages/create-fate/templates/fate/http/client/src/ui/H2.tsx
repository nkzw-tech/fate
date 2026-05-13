import cx from '../lib/cx.tsx';

export default function H2({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2 className={cx('text-2xl font-semibold text-gray-900 dark:text-gray-50', className)}>
      {children}
    </h2>
  );
}
