import type { CheckedRequest, FateRoots, Request, RequestOptions, RequestResult } from '@nkzw/fate';
import { toValue, type MaybeRefOrGetter } from 'vue';
import { getFateClientSource, useFateClient } from './context.ts';
import type { Roots } from './useRequest.ts';

/** Returns a stable callback that refreshes the current request only when invoked. */
export function useRefetch<const R extends Request, O extends FateRoots = Roots>(
  request: MaybeRefOrGetter<CheckedRequest<O, R>>,
  options: MaybeRefOrGetter<Omit<RequestOptions, 'mode'>> = {},
): () => Promise<RequestResult<O, R>> {
  const clientSource = getFateClientSource(useFateClient());
  return () =>
    clientSource.value.request(toValue(request), {
      ...toValue(options),
      mode: 'network-only',
    }) as Promise<RequestResult<O, R>>;
}
