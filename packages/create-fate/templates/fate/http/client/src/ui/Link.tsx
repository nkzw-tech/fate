import { Link as VoidLink } from '@void/react';
import type { ComponentProps } from 'react';

export type LinkProps = Omit<ComponentProps<typeof VoidLink>, 'href'> & {
  href?: string;
  to?: string;
};

export default function Link({ href, to, ...props }: LinkProps) {
  return <VoidLink href={href ?? to ?? '/'} {...props} />;
}
