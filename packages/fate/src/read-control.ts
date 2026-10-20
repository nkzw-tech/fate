/** Wait for one reader without letting its cancellation settle another reader's promise. */
export const abortable = <T>(promise: PromiseLike<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) {
    return Promise.resolve(promise);
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) {
      reject(signal.reason);
    } else {
      signal.addEventListener('abort', abort, { once: true });
    }
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
};

export const validateTimeout = (timeout: number | undefined) => {
  if (
    timeout !== undefined &&
    (!Number.isFinite(timeout) || timeout < 0 || timeout > 2 ** 31 - 1)
  ) {
    throw new Error(
      'fate: timeout must be a finite duration between 0 and 2147483647 milliseconds.',
    );
  }
};

export const readControl = ({
  signal,
  timeout,
}: { signal?: AbortSignal; timeout?: number } = {}) => {
  if (timeout === undefined && !signal) {
    return undefined;
  }
  const controller = new AbortController();
  const abort = () => controller.abort(signal!.reason);
  if (signal?.aborted) {
    abort();
  } else {
    signal?.addEventListener('abort', abort, { once: true });
  }
  const timer =
    timeout === undefined || controller.signal.aborted
      ? undefined
      : setTimeout(
          () =>
            controller.abort(
              new DOMException(
                `fate: Request timed out after ${timeout} milliseconds.`,
                'TimeoutError',
              ),
            ),
          timeout,
        );
  return {
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    },
    signal: controller.signal,
  };
};

type SharedRead<T> = {
  controller: AbortController | undefined;
  promise: Promise<T>;
  readers: number;
  settled: boolean;
};

/** Pending work is shared; only the final departing reader may abort its execution. */
export class SharedReads<T> {
  private readonly pending = new Map<string, SharedRead<T>>();

  run(
    key: string,
    execute: (signal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    let entry = this.pending.get(key);
    if (!entry) {
      const controller = signal ? new AbortController() : undefined;
      let promise: Promise<T>;
      try {
        // Preserve the calling convention of custom transports for ordinary reads.
        promise = execute(controller?.signal);
      } catch (error) {
        promise = Promise.reject(error);
      }
      entry = { controller, promise, readers: 0, settled: false };
      const current = entry;
      this.pending.set(key, current);
      const settle = () => {
        current.settled = true;
        if (this.pending.get(key) === current) {
          this.pending.delete(key);
        }
      };
      void promise.then(settle, (error) => {
        settle();
        // A failed compound read no longer needs its unfinished sibling operations.
        current.controller?.abort(error);
      });
    }
    const current = entry;
    current.readers++;
    const release = () => {
      if (--current.readers === 0 && !current.settled) {
        if (this.pending.get(key) === current) {
          this.pending.delete(key);
        }
        current.controller?.abort(signal?.reason);
      }
    };
    return abortable(current.promise, signal).then(
      (value) => {
        release();
        return value;
      },
      (error) => {
        release();
        throw error;
      },
    );
  }
}

/** A shared wire request stays alive while any operation in the batch still needs it. */
export const batchReadControl = (operations: ReadonlyArray<{ signal?: AbortSignal }>) => {
  const counts = new Map<AbortSignal, number>();
  for (const { signal } of operations) {
    if (signal) {
      counts.set(signal, (counts.get(signal) ?? 0) + 1);
    }
  }
  if (!counts.size) {
    return undefined;
  }
  const controller = new AbortController();
  let remaining = operations.length;
  const listeners = new Map<AbortSignal, () => void>();
  for (const [signal, count] of counts) {
    const abort = () => {
      remaining -= count;
      if (remaining === 0) {
        controller.abort(signal.reason);
      }
    };
    listeners.set(signal, abort);
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener('abort', abort, { once: true });
    }
  }
  return {
    dispose: () => {
      for (const [signal, listener] of listeners) {
        signal.removeEventListener('abort', listener);
      }
    },
    signal: controller.signal,
  };
};
