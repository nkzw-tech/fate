import { ConnectionTag, ViewsTag, type AnyRecord } from './types.ts';

const sameFields = (left: AnyRecord | undefined, right: AnyRecord | undefined) =>
  left === right ||
  (!!left &&
    !!right &&
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(
      (key) => Object.hasOwn(right, key) && Object.is(left[key], right[key]),
    ));

/** Shallowly recycle completed selection containers; opaque scalar values are never traversed. */
export function recycleViewResult<T>(next: T, previous: unknown): T {
  if (
    Object.is(next, previous) ||
    !next ||
    typeof next !== 'object' ||
    !previous ||
    typeof previous !== 'object'
  ) {
    return next;
  }
  const names = (next as any)[ViewsTag] as ReadonlySet<string> | undefined;
  const oldNames = (previous as any)[ViewsTag] as ReadonlySet<string> | undefined;
  if (
    !(
      names === oldNames ||
      (!!names &&
        !!oldNames &&
        names.size === oldNames.size &&
        [...names].every((name) => oldNames.has(name)))
    ) ||
    !sameFields((next as any)[ConnectionTag], (previous as any)[ConnectionTag])
  ) {
    return next;
  }
  const equal = Array.isArray(next)
    ? Array.isArray(previous) &&
      next.length === previous.length &&
      next.every((value, index) => Object.is(value, previous[index]))
    : !Array.isArray(previous) && sameFields(next as AnyRecord, previous as AnyRecord);
  return equal ? (previous as T) : next;
}
