import type { RequestOptions } from './client.ts';

export type RequestStateOptions = Omit<RequestOptions, 'mode'> & {
  enabled?: boolean;
  mode?: RequestOptions['mode'] | 'cache-only';
};

export type RequestState<T> = Readonly<{
  data: T | undefined;
  error: unknown;
  isFetching: boolean;
  refetch: () => Promise<T>;
  status: 'disabled' | 'missing' | 'pending' | 'ready' | 'error';
}>;

export type RequestObserver<T> = Readonly<{
  getSnapshot: () => RequestState<T>;
  subscribe: (listener: () => void) => () => void;
}>;

export const createRequestObserver = <T>({
  options,
  read,
  restore,
  retain,
  start,
  subscribe,
}: {
  options: RequestStateOptions;
  /** Returns the same result identity until its request data changes. */
  read: () => T | undefined;
  restore?: () => Promise<void>;
  retain: () => { dispose: () => void };
  start: (refresh: boolean) => Promise<T>;
  subscribe: (listener: () => void) => () => void;
}): RequestObserver<T> => {
  const enabled = options.enabled !== false;
  const cacheOnly = options.mode === 'cache-only';
  const listeners = new Set<() => void>();
  let snapshot: RequestState<T> | undefined;
  let requestError: unknown;
  let fetching = false;
  let started = false;
  let inFlight: Promise<T> | undefined;
  let completed = false;
  let unsubscribe: (() => void) | undefined;
  let retained: { dispose: () => void } | undefined;

  const getSnapshot = (): RequestState<T> => {
    const data = enabled && (options.mode !== 'network-only' || completed) ? read() : undefined;
    const next: RequestState<T> = {
      data,
      error: requestError,
      isFetching: fetching,
      refetch,
      status: !enabled
        ? 'disabled'
        : data !== undefined
          ? 'ready'
          : requestError !== undefined
            ? 'error'
            : (cacheOnly && !fetching && (!restore || started)) || (completed && !fetching)
              ? 'missing'
              : 'pending',
    };
    if (
      snapshot &&
      snapshot.status === next.status &&
      snapshot.error === requestError &&
      snapshot.isFetching === fetching &&
      Object.is(snapshot.data, data)
    ) {
      return snapshot;
    }
    snapshot = next;
    return next;
  };
  const notify = () => {
    const previous = snapshot;
    if (getSnapshot() !== previous) {
      for (const listener of listeners) {
        listener();
      }
    }
  };
  const execute = (refresh: boolean): Promise<T> => {
    if (!enabled || cacheOnly) {
      return Promise.reject(new Error('fate: Cannot refetch a disabled or cache-only request.'));
    }
    if (inFlight) {
      return inFlight;
    }
    started = true;
    fetching = true;
    requestError = undefined;
    inFlight = Promise.resolve()
      .then(() => start(refresh))
      .then(
        (data) => {
          completed = true;
          return data;
        },
        (error) => {
          requestError = error;
          throw error;
        },
      )
      .finally(() => {
        inFlight = undefined;
        fetching = false;
        notify();
      });
    notify();
    return inFlight;
  };
  const refetch = () => execute(true);
  return {
    getSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && enabled) {
        retained = retain();
        unsubscribe = subscribe(notify);
        if (!started && cacheOnly && restore) {
          started = true;
          fetching = true;
          const restoreCache = async () => {
            try {
              await restore();
            } catch (error) {
              requestError = error;
            } finally {
              fetching = false;
              notify();
            }
          };
          void restoreCache();
          notify();
        }
        if (!started && !cacheOnly) {
          // Automatic work reports failures through the snapshot; explicit refetches reject.
          void execute(false).catch(() => {});
        }
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          unsubscribe?.();
          unsubscribe = undefined;
          retained?.dispose();
          retained = undefined;
        }
      };
    },
  };
};
