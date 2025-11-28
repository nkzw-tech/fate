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

/**
 * Collects all view payloads that apply to the given ref.
 */
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
    if (isViewTag(key) && (!ref || ref[ViewsTag]?.has(key))) {
      result.push(value);
    }
  }
  return result;
};

/**
 * Returns the set of view tags defined on a view composition.
 */
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

/**
 * Extracts view tags from a nested selection object.
 */
export const getSelectionViewNames = <T extends Entity, S extends Selection<T>>(
  selection: S,
): ReadonlySet<ViewTag> => {
  return getViewNames(selection as unknown as View<T, S>);
};

let id = 0;

type SelectionValidation<T extends Entity, S extends Selection<T>> =
  Exclude<
    keyof Omit<S, typeof __FateEntityBrand | typeof __FateSelectionBrand>,
    keyof Selection<T>
  > extends never
    ? unknown
    : never;

/**
 * Creates a reusable view for an object using the declared selection.
 *
 * @example
 * const PostView = view<Post>()({
 *   id: true,
 *   title: true,
 * });
 */
export function view<T extends Entity>() {
  const viewId = id++;

  return <S extends Selection<T>>(
    select: S & SelectionValidation<T, S>,
  ): View<T, S> => {
    const payload = Object.freeze({
      select,
      [ViewKind]: true,
    }) as ViewPayload<T, S>;

    const viewComposition = Object.defineProperty({}, getViewTag(viewId), {
      configurable: false,
      enumerable: true,
      value: payload,
      writable: false,
    });

    return Object.freeze(viewComposition) as View<T, S>;
  };
}
