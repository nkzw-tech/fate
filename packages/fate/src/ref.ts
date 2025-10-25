import { getFragmentNames } from './fragment.ts';
import {
  Entity,
  EntityId,
  FateRecord,
  Fragment,
  FragmentRef,
  FragmentsTag,
  Selection,
  TypeName,
} from './types.ts';

export const toEntityId = (type: TypeName, rawId: string | number): EntityId =>
  `${type}:${String(rawId)}`;

export function parseEntityId(id: EntityId) {
  const idx = id.indexOf(':');
  return idx < 0
    ? { id, type: '' }
    : ({ id: id.slice(idx + 1), type: id.slice(0, idx) } as const);
}

export function assignFragmentTag(
  target: FateRecord,
  value: ReadonlySet<string>,
) {
  Object.defineProperty(target, FragmentsTag, {
    configurable: false,
    enumerable: false,
    value,
    writable: false,
  });
}

export default function createRef<
  T extends Entity,
  S extends Selection<T>,
  F extends Fragment<T, S>,
>(
  __typename: string,
  id: string | number,
  fragment: F,
): FragmentRef<T['__typename']> {
  const ref = { __typename, id };

  assignFragmentTag(ref, getFragmentNames(fragment));

  return ref as FragmentRef<T['__typename']>;
}
