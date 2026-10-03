/* eslint-disable react/immutability, react/refs, react-hooks/exhaustive-deps --
 * These are the primitives React ships natively (`useSyncExternalStore`,
 * `use(useDeferredValue())`, `useEffectEvent`); they need to mutate store state
 * and read refs during render. */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { readThenable, track } from './thenable.ts';

type Store<T> = { getSnapshot: () => T; value: T };

const didSnapshotChange = <T>(store: Store<T>) => {
  try {
    return !Object.is(store.value, store.getSnapshot());
  } catch {
    return true;
  }
};

/**
 * `useSyncExternalStore` on `preact/hooks`, without `preact/compat`.
 */
export function useSyncExternalStore<T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T,
): T {
  const value = getSnapshot();
  const [{ store }, forceUpdate] = useState<{ store: Store<T> }>(() => ({
    store: { getSnapshot, value },
  }));

  useLayoutEffect(() => {
    store.value = value;
    store.getSnapshot = getSnapshot;

    if (didSnapshotChange(store)) {
      forceUpdate({ store });
    }
  }, [subscribe, value, getSnapshot]);

  useEffect(() => {
    if (didSnapshotChange(store)) {
      forceUpdate({ store });
    }

    return subscribe(() => {
      if (didSnapshotChange(store)) {
        forceUpdate({ store });
      }
    });
  }, [subscribe]);

  return value;
}

/**
 * Reads a thenable the way `use(useDeferredValue(thenable))` does in React:
 * the first render suspends, but once a value was shown, a new pending thenable
 * keeps returning that value until the new one settles, instead of falling
 * back to a loading state.
 */
export function useDeferredThenable<T>(thenable: PromiseLike<T>): T {
  const lastValue = useRef<{ value: T } | null>(null);
  const [, rerender] = useState(0);
  const tracked = track(thenable);
  const pending = tracked.status === 'pending' ? tracked : null;

  useEffect(() => {
    if (!pending) {
      return;
    }

    let active = true;
    const settle = () => {
      if (active) {
        rerender((count) => count + 1);
      }
    };
    pending.then(settle, settle);
    return () => {
      active = false;
    };
  }, [pending]);

  if (pending && lastValue.current) {
    return lastValue.current.value;
  }

  if (pending) {
    retryOnSettle(pending, rerender);
  }

  const value = readThenable(tracked);
  lastValue.current = { value };
  return value;
}

/**
 * Like `readThenable`, but as a hook that re-renders its component once a
 * pending thenable settles. Pass `null` to read nothing.
 */
export function useThenable<T>(thenable: PromiseLike<T> | null): T | undefined {
  const [, rerender] = useState(0);
  if (!thenable) {
    return undefined;
  }

  const tracked = track(thenable);
  if (tracked.status === 'pending') {
    retryOnSettle(tracked, rerender);
  }
  return readThenable(tracked);
}

// Like React's `use`, a component that suspends renders again by itself once
// its thenable settles. Boundaries such as preact-iso's `<Router>` and
// `<ErrorBoundary>` only re-render themselves, which stops at the first
// unchanged vnode above the suspended component.
const retryOnSettle = (
  thenable: PromiseLike<unknown>,
  rerender: (update: (count: number) => number) => void,
) => {
  const retry = () => rerender((count) => count + 1);
  thenable.then(retry, retry);
};

/**
 * Returns a stable function that always calls the latest `callback`.
 */
export function useEffectEvent<A extends Array<unknown>, R>(
  callback: (...args: A) => R,
): (...args: A) => R {
  const ref = useRef(callback);
  ref.current = callback;
  return useRef((...args: A) => ref.current(...args)).current;
}
