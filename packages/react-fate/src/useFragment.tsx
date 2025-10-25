import type {
  __FateEntityBrand,
  __FateSelectionBrand,
  Fragment,
  FragmentData,
  FragmentRef,
  FragmentTag,
} from '@nkzw/fate';
import { toEntityId } from '@nkzw/fate/src/ref.ts';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

  const readFragment = useCallback(
    () =>
      client.readFragmentOrThrow<
        FragmentEntity<F>,
        F[FragmentTag]['select'],
        F
      >(fragment, ref),
    [client, fragment, ref],
  );

  const [record, setRecord] = useState(readFragment);

  useEffect(() => {
    const dispose = client.store.subscribe(id, () => setRecord(readFragment()));
    return () => {
      dispose();
    };
  }, [client.store, id, readFragment]);

  return record;
}
