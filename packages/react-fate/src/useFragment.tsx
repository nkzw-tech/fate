import type { Entity, Fragment, FragmentRef, Selection } from '@nkzw/fate';
import { useCallback, useSyncExternalStore } from 'react';
import { useFateClient } from './context.tsx';

export function useFragment<T extends Entity, S extends Selection<T>>(
  fragment: Fragment<T, S>,
  ref: FragmentRef<string>,
) {
  const client = useFateClient();
  const id = client.idOf(ref);

  const getSnapshot = useCallback(
    () => client.readFragmentOrThrow<T, S, Fragment<T, S>>(fragment, ref),
    [client, fragment, ref],
  );

  const subscribe = useCallback(
    (onStoreChange: () => void) => client.store.subscribe(id, onStoreChange),
    [client, id],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
