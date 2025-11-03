import type {
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

export function hasViewTag(value: unknown): boolean {
  return !!getViewPayloads(value as View<Entity, Selection<Entity>>, null)
    ?.length;
}

let id = 0;

export function view<T extends Entity>() {
  const viewId = id++;

  return <S extends Selection<T>>(select: S): View<T, S> => {
    return Object.defineProperty({}, getViewTag(viewId), {
      configurable: false,
      enumerable: true,
      value: {
        select,
        [ViewKind]: true,
      },
      writable: false,
    }) as View<T, S>;
  };
}
