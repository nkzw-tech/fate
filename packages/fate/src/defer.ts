import {
  DeferTag,
  DeferredTag,
  type Deferred,
  type DeferredMetadata,
  type DeferredSelection,
} from './types.ts';

export function defer<const S>(selection: S): DeferredSelection<S> {
  return Object.freeze({
    [DeferTag]: selection,
  }) as DeferredSelection<S>;
}

export const isDeferredSelection = (value: unknown): value is DeferredSelection<unknown> =>
  typeof value === 'object' && value !== null && DeferTag in value;

export const getDeferredSelection = <S>(selection: DeferredSelection<S>): S => selection[DeferTag];

export const createDeferred = <T>(metadata: DeferredMetadata): Deferred<T> =>
  Object.freeze({
    [DeferredTag]: metadata,
  }) as Deferred<T>;

export const isDeferred = (value: unknown): value is Deferred<unknown> =>
  typeof value === 'object' && value !== null && DeferredTag in value;

export const getDeferredMetadata = <T>(deferred: Deferred<T>): DeferredMetadata =>
  deferred[DeferredTag];
