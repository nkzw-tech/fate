import type { ComponentChildren } from 'preact';

/**
 * Stand-in for React's `<Activity>`: hidden children stay mounted (keeping
 * their state) but are not displayed. `display: contents` keeps the wrapper out
 * of the layout while visible.
 */
export default function Activity({
  children,
  mode,
}: {
  children?: ComponentChildren;
  mode: 'hidden' | 'visible';
}) {
  return <div style={{ display: mode === 'hidden' ? 'none' : 'contents' }}>{children}</div>;
}
