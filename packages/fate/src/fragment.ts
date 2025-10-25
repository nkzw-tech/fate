import type {
  Entity,
  Fragment,
  FragmentPayload,
  FragmentRef,
  FragmentTag,
  Selection,
} from './types.ts';
import {
  FragmentKind,
  FragmentsTag,
  getFragmentTag,
  isFragmentTag,
} from './types.ts';

export const getFragmentPayloads = <
  T extends Entity,
  S extends Selection<T>,
  F extends Fragment<T, S>,
>(
  fragment: F,
  ref: FragmentRef<T['__typename']> | null,
): ReadonlyArray<FragmentPayload<T, S>> => {
  const result: Array<FragmentPayload<T, S>> = [];
  for (const [key, value] of Object.entries(fragment)) {
    if (isFragmentTag(key) && (!ref || ref[FragmentsTag].has(key))) {
      result.push(value);
    }
  }
  return result;
};

export const getFragmentNames = <
  T extends Entity,
  S extends Selection<T>,
  F extends Fragment<T, S>,
>(
  fragment: F,
): ReadonlySet<FragmentTag> => {
  const result = new Set<FragmentTag>();
  for (const key of Object.keys(fragment)) {
    if (isFragmentTag(key)) {
      result.add(key);
    }
  }
  return result;
};

export function hasFragmentTag(value: unknown): boolean {
  return !!getFragmentPayloads(
    value as Fragment<Entity, Selection<Entity>>,
    null,
  )?.length;
}

let id = 0;

export function fragment<T extends Entity>() {
  const fragmentId = id++;

  return <S extends Selection<T>>(select: S): Fragment<T, S> => {
    return Object.defineProperty({}, getFragmentTag(fragmentId), {
      configurable: false,
      enumerable: true,
      value: {
        [FragmentKind]: true,
        select,
      },
      writable: false,
    }) as Fragment<T, S>;
  };
}
