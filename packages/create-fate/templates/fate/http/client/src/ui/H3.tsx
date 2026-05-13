import cx from '../lib/cx.tsx';

export default function H2({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={cx(
        'bg-linear-to-r from-slate-900 to-slate-600 bg-clip-text text-lg font-semibold text-transparent transition dark:from-white dark:to-slate-200 uppercase tracking-widest duration-150 opacity-100 hover:opacity-70 active:translate-y-[1.5px]',
        className,
      )}
    >
      {children}
    </h3>
  );
}
