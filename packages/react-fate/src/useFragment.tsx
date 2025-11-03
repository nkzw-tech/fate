import {
  __FateEntityBrand,
  __FateSelectionBrand,
  Fragment,
  FragmentData,
  FragmentRef,
  FragmentTag,
  toEntityId,
} from '@nkzw/fate';
import {
  use,
  useCallback,
  useDeferredValue,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { useFateClient } from './context.tsx';

type FragmentEntity<F> = F extends { readonly [__FateEntityBrand]?: infer T }
  ? T
  : never;

type FragmentSelection<F> = F extends {
  readonly [__FateSelectionBrand]?: infer S;
}
  ? S
  : never;

export function useFragment<F extends Fragment<any, any>>(
  fragment: F,
  ref: FragmentRef<FragmentEntity<F>['__typename']>,
): FragmentData<FragmentEntity<F>, FragmentSelection<F>> {
  const client = useFateClient();
  const id = useMemo(() => toEntityId(ref.__typename, ref.id), [ref]);

  const getSnapshot = useCallback(
    () =>
      client.readFragment<FragmentEntity<F>, F[FragmentTag]['select'], F>(
        fragment,
        ref,
      ),
    [client, fragment, ref],
  );

  const subscribe = useCallback(
    (onStoreChange: () => void) => client.store.subscribe(id, onStoreChange),
    [client, id],
  );

  return use(
    useDeferredValue(useSyncExternalStore(subscribe, getSnapshot, getSnapshot)),
  );
}
