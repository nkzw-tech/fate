import type { FateThenable } from '@nkzw/fate';

export const fulfilledThenable = <T>(value: T): FateThenable<T> => ({
  status: 'fulfilled',
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(value).then(onfulfilled ?? undefined, onrejected ?? undefined);
  },
  value,
});

export const isFulfilledThenable = <T>(
  value: PromiseLike<T>,
): value is FateThenable<T> & { status: 'fulfilled'; value: T } =>
  'status' in value && value.status === 'fulfilled' && 'value' in value;
