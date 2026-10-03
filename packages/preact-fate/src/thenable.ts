import type { FateThenable } from '@nkzw/fate';

export type FulfilledThenable<T> = FateThenable<T> & {
  status: 'fulfilled';
  value: T;
};

type TrackedThenable<T> = PromiseLike<T> & {
  reason?: unknown;
  status?: 'fulfilled' | 'pending' | 'rejected';
  value?: T;
};

export const isFulfilledThenable = <T>(value: PromiseLike<T>): value is FulfilledThenable<T> =>
  'status' in value && (value as { status?: unknown }).status === 'fulfilled' && 'value' in value;

export const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  value != null && typeof (value as PromiseLike<unknown>).then === 'function';

export const fulfilledThenable = <T>(value: T): FulfilledThenable<T> =>
  ({
    status: 'fulfilled',
    then<TResult1 = T, TResult2 = never>(
      onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(value).then(onfulfilled, onrejected);
    },
    value,
  }) satisfies FulfilledThenable<T>;

/**
 * Records `status`/`value`/`reason` on a thenable, following the same protocol
 * as React's `use`, so a render after it settles can read it synchronously.
 * fate's own request promises already track their status.
 */
export function track<T>(thenable: PromiseLike<T>): TrackedThenable<T> {
  const tracked = thenable as TrackedThenable<T>;
  if (!tracked.status) {
    tracked.status = 'pending';
    tracked.then(
      (value) => {
        if (tracked.status === 'pending') {
          tracked.status = 'fulfilled';
          tracked.value = value;
        }
      },
      (error) => {
        if (tracked.status === 'pending') {
          tracked.status = 'rejected';
          tracked.reason = error;
        }
      },
    );
  }
  return tracked;
}

/**
 * Returns the value of a settled thenable, throws its rejection, or throws the
 * thenable itself so the nearest `<Suspense>` can show a fallback.
 * Not a hook, so it may be called conditionally.
 */
export function readThenable<T>(thenable: PromiseLike<T>): T {
  const tracked = track(thenable);
  if (tracked.status === 'fulfilled') {
    return tracked.value as T;
  }
  if (tracked.status === 'rejected') {
    throw tracked.reason;
  }
  throw tracked;
}
