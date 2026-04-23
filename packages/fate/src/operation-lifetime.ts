import type { RequestDescriptor } from './request-descriptor.ts';

type RetainedOperation = {
  descriptor: RequestDescriptor;
  refCount: number;
};

export type RetainHandle = Readonly<{
  dispose(): void;
}>;

export default class OperationLifetime {
  private readonly operations = new Map<string, RetainedOperation>();
  private readonly releaseBuffer: Array<string> = [];

  constructor(private readonly releaseBufferSize: number) {}

  retain(descriptor: RequestDescriptor, onDispose?: () => void): RetainHandle {
    let operation = this.operations.get(descriptor.key);
    if (!operation) {
      operation = { descriptor, refCount: 0 };
      this.operations.set(descriptor.key, operation);
    }

    operation.refCount += 1;
    this.removeFromReleaseBuffer(descriptor.key);

    let disposed = false;
    return {
      dispose: () => {
        if (disposed) {
          return;
        }

        disposed = true;
        if (this.release(descriptor.key)) {
          onDispose?.();
        }
      },
    };
  }

  getDescriptors(): ReadonlyArray<RequestDescriptor> {
    return [...this.operations.values()].map((operation) => operation.descriptor);
  }

  private release(key: string): boolean {
    const operation = this.operations.get(key);
    if (!operation) {
      return false;
    }

    operation.refCount -= 1;
    if (operation.refCount > 0) {
      return false;
    }

    if (this.releaseBufferSize <= 0) {
      this.operations.delete(key);
      return true;
    }

    this.releaseBuffer.push(key);
    let released = false;

    while (this.releaseBuffer.length > this.releaseBufferSize) {
      const releasedKey = this.releaseBuffer.shift();
      if (!releasedKey) {
        continue;
      }

      const releasedOperation = this.operations.get(releasedKey);
      if (releasedOperation && releasedOperation.refCount <= 0) {
        this.operations.delete(releasedKey);
        released = true;
      }
    }

    return released;
  }

  private removeFromReleaseBuffer(key: string) {
    const index = this.releaseBuffer.indexOf(key);
    if (index !== -1) {
      this.releaseBuffer.splice(index, 1);
    }
  }
}
