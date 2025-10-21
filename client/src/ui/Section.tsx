import { VStack } from '@nkzw/stack';
import { ReactNode } from 'react';
import cx from '../lib/cx.tsx';

export default function Section({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className="px-4 py-8">
      <VStack className={cx('container mx-auto max-w-4xl', className)} gap>
        {children}
      </VStack>
    </section>
  );
}
