import type {
  Deferred,
  View,
  ViewData,
  ViewEntity,
  ViewEntityName,
  ViewSelection,
} from '@nkzw/fate';
import { type ViewInput, useViewSnapshots } from './useViewSnapshots.ts';

type ViewResult<V extends View<any, any>, R> =
  R extends Deferred<infer Resolved>
    ? ViewResult<V, Resolved>
    : R extends null | undefined
      ? R
      : ViewData<ViewEntity<V> & { __typename: ViewEntityName<V> }, ViewSelection<V>>;

/**
 * Resolves an array of references against a view and subscribes to their selections.
 * Preserves order, duplicates, and null or undefined entries. Missing data suspends,
 * with all reads started together. Parameter bindings are read from each reference.
 *
 * @example
 * const users = useViews(UserView, userRefs);
 * return users.map((user) => <span key={user.id}>{user.name}</span>);
 */
export function useViews<V extends View<any, any>, const R extends ReadonlyArray<ViewInput<V>>>(
  view: V,
  refs: R,
): { readonly [K in keyof R]: ViewResult<V, R[K]> } {
  return useViewSnapshots(view, refs) as { readonly [K in keyof R]: ViewResult<V, R[K]> };
}
