import type {
  __FateEntityBrand,
  __FateSelectionBrand,
  Entity,
  Selection,
  View,
  ViewPayload,
  ViewRef,
  ViewTag,
} from './types.ts';
import { getViewTag, isViewTag, ViewKind, ViewsTag } from './types.ts';

export const getViewPayloads = <
  T extends Entity,
  S extends Selection<T>,
  V extends View<T, S>,
>(
  view: V,
  ref: ViewRef<T['__typename']> | null,
): ReadonlyArray<ViewPayload<T, S>> => {
  const result: Array<ViewPayload<T, S>> = [];
  for (const [key, value] of Object.entries(view)) {
    if (isViewTag(key) && (!ref || ref[ViewsTag].has(key))) {
      result.push(value);
    }
  }
  return result;
};

export const getViewNames = <
  T extends Entity,
  S extends Selection<T>,
  V extends View<T, S>,
>(
  view: V,
): ReadonlySet<ViewTag> => {
  const result = new Set<ViewTag>();
  for (const key of Object.keys(view)) {
    if (isViewTag(key)) {
      result.add(key);
    }
  }
  return result;
};

export const getSelectionViewNames = <T extends Entity, S extends Selection<T>>(
  selection: S,
): ReadonlySet<ViewTag> => {
  const result = new Set<ViewTag>();
  for (const key of Object.keys(selection)) {
    if (isViewTag(key)) {
      result.add(key);
    }
  }
  return result;
};

let id = 0;

type SelectionInput<T extends Entity, S> =
  S extends Selection<T>
    ? Exclude<
        keyof Omit<S, typeof __FateEntityBrand | typeof __FateSelectionBrand>,
        keyof Selection<T>
      > extends never
      ? S
      : never
    : never;

export function view<T extends Entity>() {
  const viewId = id++;

  return <S>(select: SelectionInput<T, S>): View<T, SelectionInput<T, S>> => {
    const payload = Object.freeze({
      select,
      [ViewKind]: true,
    }) as ViewPayload<T, SelectionInput<T, S>>;

    const viewComposition = Object.defineProperty({}, getViewTag(viewId), {
      configurable: false,
      enumerable: true,
      value: payload,
      writable: false,
    });

    return Object.freeze(viewComposition) as View<T, SelectionInput<T, S>>;
  };
}
