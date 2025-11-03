import {
  __FateEntityBrand,
  __FateSelectionBrand,
  toEntityId,
  View,
  ViewData,
  ViewRef,
  ViewTag,
} from '@nkzw/fate';
import {
  use,
  useCallback,
  useDeferredValue,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { useFateClient } from './context.tsx';

type ViewEntity<V> = V extends { readonly [__FateEntityBrand]?: infer T }
  ? T
  : never;

type ViewSelection<V> = V extends {
  readonly [__FateSelectionBrand]?: infer S;
}
  ? S
  : never;

export function useView<V extends View<any, any>>(
  view: V,
  ref: ViewRef<ViewEntity<V>['__typename']>,
): ViewData<ViewEntity<V>, ViewSelection<V>> {
  const client = useFateClient();
  const id = useMemo(() => toEntityId(ref.__typename, ref.id), [ref]);

  const getSnapshot = useCallback(
    () => client.readView<ViewEntity<V>, V[ViewTag]['select'], V>(view, ref),
    [client, view, ref],
  );

  const subscribe = useCallback(
    (onStoreChange: () => void) => client.store.subscribe(id, onStoreChange),
    [client, id],
  );

  return use(
    useDeferredValue(useSyncExternalStore(subscribe, getSnapshot, getSnapshot)),
  );
}
