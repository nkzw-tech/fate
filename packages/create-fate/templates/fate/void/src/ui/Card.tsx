import { VStack } from '@nkzw/stack';
import cx from '../lib/cx.tsx';

export default function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'squircle relative overflow-hidden border border-gray-200/70 bg-white/85 shadow-[0_16px_70px_-32px_rgba(15,23,42,0.45)] transition duration-200 ease-out hover:shadow-[0_24px_80px_-38px_rgba(15,23,42,0.55)] dark:border-neutral-800 dark:bg-neutral-900/80',
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-blue-500/10 via-transparent to-indigo-500/15 opacity-30 transition duration-200" />
      <VStack
        className="relative z-10 flex h-full w-full"
        gap={16}
        horizontalPadding={20}
        verticalPadding={16}
      >
        {children}
      </VStack>
    </div>
  );
}
