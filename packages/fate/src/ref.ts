import {
  Entity,
  EntityId,
  FateRecord,
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

export const toEntityId = (type: TypeName, rawId: string | number): EntityId =>
  `${type}:${String(rawId)}`;

export function parseEntityId(id: EntityId) {
  const idx = id.indexOf(':');
  return idx < 0
    ? { id, type: '' }
    : ({ id: id.slice(idx + 1), type: id.slice(0, idx) } as const);
}

export function assignViewTag(target: FateRecord, value: ReadonlySet<string>) {
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

  return ref as ViewRef<T['__typename']>;
}
