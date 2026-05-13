import { Gap, VStack } from '@nkzw/stack';
import { ReactNode } from 'react';
import cx from '../lib/cx.tsx';

export default function Section({
  children,
  className,
  gap,
}: {
  children: ReactNode;
  className?: string;
  gap?: Gap;
}) {
  return (
    <VStack
      as="section"
      className={cx('max-w-8xl container mx-auto px-4 py-6 lg:px-8 lg:py-10', className)}
      gap={gap}
    >
      {children}
    </VStack>
  );
}
