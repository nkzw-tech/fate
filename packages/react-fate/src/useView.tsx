import {
  Deferred,
  FateClient,
  View,
  ViewData,
  ViewEntity,
  ViewEntityName,
  ViewRef,
  ViewSelection,
} from '@nkzw/fate';
import { useViewSnapshot } from './useViewSnapshots.ts';

type ViewEntityWithTypename<V extends View<any, any>> = ViewEntity<V> & {
  __typename: ViewEntityName<V>;
};

type ViewOptions = Readonly<{ client?: FateClient<any, any> | null }>;

/**
 * Resolves a reference against a view and subscribes to updates for that selection.
 * Pass a client in the options to read outside the nearest provider's client.
 *
 * @example
 * const post = useView(PostView, postRef);
 */
export function useView<
  V extends View<any, any>,
  R extends ViewRef<ViewEntityName<V>> | null | undefined,
>(
  view: V,
  ref: R,
  options?: ViewOptions,
): R extends null | undefined ? R : ViewData<ViewEntityWithTypename<V>, ViewSelection<V>>;
export function useView<
  V extends View<any, any>,
  R extends Deferred<ViewRef<ViewEntityName<V>>> | null | undefined,
>(
  view: V,
  ref: R,
  options?: ViewOptions,
): R extends null | undefined ? R : ViewData<ViewEntityWithTypename<V>, ViewSelection<V>>;
export function useView<V extends View<any, any>>(
  view: V,
  ref: Deferred<ViewRef<ViewEntityName<V>>> | ViewRef<ViewEntityName<V>> | null | undefined,
  options?: ViewOptions,
): ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null | undefined;
export function useView<V extends View<any, any>>(
  view: V,
  ref: Deferred<ViewRef<ViewEntityName<V>>> | ViewRef<ViewEntityName<V>> | null | undefined,
  options?: ViewOptions,
): ViewData<ViewEntityWithTypename<V>, ViewSelection<V>> | null | undefined {
  return useViewSnapshot(view, ref, options?.client) as
    | ViewData<ViewEntityWithTypename<V>, ViewSelection<V>>
    | null
    | undefined;
}
