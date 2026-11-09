import { Link as VoidLink } from '@void/react';
import type { ComponentProps } from 'react';

type VoidLinkProps = ComponentProps<typeof VoidLink>;

export type LinkProps = Omit<VoidLinkProps, 'href'> & {
  href?: VoidLinkProps['href'];
  to?: VoidLinkProps['href'];
};

export default function Link({ href, to, ...props }: LinkProps) {
  return <VoidLink href={href ?? to ?? '/'} {...props} />;
}
