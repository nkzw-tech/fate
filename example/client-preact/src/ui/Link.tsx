import type { AnchorHTMLAttributes } from 'preact';

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'role'> & {
  href?: string;
  to?: string;
};

/**
 * Replaces void's `<Link>`: preact-iso's `<LocationProvider>` intercepts clicks
 * on same-origin `<a href>` elements and navigates client-side.
 */
export default function Link({ href, to, ...props }: LinkProps) {
  return <a href={href ?? to ?? '/'} {...props} />;
}
