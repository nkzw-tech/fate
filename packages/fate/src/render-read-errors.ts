type ReadEntry = {
  error?: unknown;
  failed: boolean;
  promise: PromiseLike<unknown>;
  requestKey: string;
};

// React can discard a reader before its first commit. Keep its failure with the
// client, rather than relying on uncommitted hook state to deliver the error.
export default class RenderReadErrors {
  private readonly initialScope = {};
  private readonly entries = new WeakMap<object, WeakMap<object, WeakMap<object, ReadEntry>>>();

  clear(owner: object, input: object) {
    this.entries.get(owner)?.delete(input);
  }

  read<T>(
    owner: object,
    input: object,
    scope: object | null | undefined,
    requestKey: string,
    read: () => PromiseLike<T>,
  ) {
    if (scope === undefined) {
      // Imperative reads are intentional retries, unlike React render retries.
      return read();
    }
    const key = scope ?? this.initialScope;
    let inputs = this.entries.get(owner);
    let scopes = inputs?.get(input);
    const previous = scopes?.get(key);
    if (previous?.failed && previous.requestKey === requestKey) {
      throw previous.error;
    }
    const promise = read();
    if (previous?.promise === promise || ('status' in promise && promise.status === 'fulfilled')) {
      return promise;
    }
    if (!inputs) {
      inputs = new WeakMap();
      this.entries.set(owner, inputs);
    }
    if (!scopes) {
      scopes = new WeakMap();
      inputs.set(input, scopes);
    }
    const entry: ReadEntry = {
      failed: false,
      promise,
      requestKey,
    };
    scopes.set(key, entry);
    void Promise.resolve(promise).then(
      () => {
        if (scopes.get(key) === entry) {
          scopes.delete(key);
        }
      },
      (error) => {
        if (scopes.get(key) === entry) {
          entry.error = error;
          entry.failed = true;
        }
      },
    );
    return promise;
  }
}
