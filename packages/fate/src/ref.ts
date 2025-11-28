import {
  AnyRecord,
  Entity,
  EntityId,
  Selection,
  TypeName,
  View,
  ViewRef,
  ViewsTag,
} from './types.ts';
import {
  getSelectionViewNames,
  getViewNames,
  getViewPayloads,
} from './view.ts';

/**
 * Builds the canonical cache ID for an entity.
 */
export const toEntityId = (type: TypeName, rawId: string | number): EntityId =>
  `${type}:${String(rawId)}`;

/**
 * Splits a cache entity ID back into its type and raw identifier.
 */
export function parseEntityId(id: EntityId) {
  const idx = id.indexOf(':');
  return idx < 0
    ? { id, type: '' }
    : ({ id: id.slice(idx + 1), type: id.slice(0, idx) } as const);
}

/**
 * Attaches view tags to a ref without leaking the symbol.
 */
export function assignViewTag(target: AnyRecord, value: ReadonlySet<string>) {
  Object.defineProperty(target, ViewsTag, {
    configurable: false,
    enumerable: false,
    value,
    writable: false,
  });
}

const getRootViewNames = (view: View<any, any>) => {
  const names = new Set<string>(getViewNames(view));
  const payloads = getViewPayloads(view, null);
  for (const payload of payloads) {
    for (const name of getSelectionViewNames(payload.select)) {
      names.add(name);
    }
  }
  return names;
};

/**
 * Creates an immutable `ViewRef` for an entity, tagging it with all views from
 * the provided composition so `useView` can resolve the ref against a view.
 */
export default function createRef<
  T extends Entity,
  S extends Selection<T>,
  V extends View<T, S>,
>(
  __typename: string,
  id: string | number,
  view: V,
  options?: { root?: boolean },
): ViewRef<T['__typename']> {
  const ref = { __typename, id };

  const names = options?.root ? getRootViewNames(view) : getViewNames(view);
  assignViewTag(ref, names);

  return Object.freeze(ref) as ViewRef<T['__typename']>;
}
