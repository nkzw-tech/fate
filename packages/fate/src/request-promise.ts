export default class FateRequestPromise<T, TDescriptor = unknown> implements Promise<T> {
  readonly [Symbol.toStringTag] = 'Promise';

  reason?: unknown;
  status: 'fulfilled' | 'pending' | 'rejected' = 'pending';

  private execution: Promise<T> | null = null;

  constructor(
    readonly descriptor: TDescriptor,
    private readonly readValue: () => T,
  ) {}

  get value(): T {
    return this.readValue();
  }

  start(execution: Promise<T>) {
    this.execution = execution;
    this.reason = undefined;
    this.status = 'pending';

    void execution.then(
      () => {
        if (this.execution !== execution) {
          return;
        }

        this.execution = null;
        this.status = 'fulfilled';
      },
      (error) => {
        if (this.execution !== execution) {
          return;
        }

        this.execution = null;
        this.reason = error;
        this.status = 'rejected';
      },
    );
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    switch (this.status) {
      case 'fulfilled':
        return Promise.resolve()
          .then(() => this.readValue())
          .then(onfulfilled ?? undefined, onrejected ?? undefined);
      case 'rejected':
        return Promise.reject(this.reason).then(onfulfilled ?? undefined, onrejected ?? undefined);
      case 'pending':
      default:
        if (!this.execution) {
          throw new Error(`fate: Pending request is missing its execution.`);
        }
        return this.execution.then(onfulfilled ?? undefined, onrejected ?? undefined);
    }
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<T | TResult> {
    return this.then(undefined, onrejected ?? undefined);
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.then(
      async (value) => {
        await onfinally?.();
        return value;
      },
      async (error) => {
        await onfinally?.();
        throw error;
      },
    );
  }
}
