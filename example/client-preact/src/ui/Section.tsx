import type { ComponentChildren } from 'preact';
import cx from '../lib/cx.ts';
import { type Gap, VStack } from './Stack.tsx';

export default function Section({
  children,
  className,
  gap,
}: {
  children: ComponentChildren;
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
