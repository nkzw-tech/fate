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
    <VStack
      className={cx(
        'rounded-lg border border-gray-200 shadow-sm dark:border-neutral-800',
        className,
      )}
      gap={16}
      padding
      verticalPadding={12}
    >
      {children}
    </VStack>
  );
}
