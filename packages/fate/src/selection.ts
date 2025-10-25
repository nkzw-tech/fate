import { getFragmentPayloads } from './fragment.ts';
import {
  FragmentKind,
  FragmentRef,
  FragmentsTag,
  isFragmentTag,
  type Entity,
  type Fragment,
  type Selection,
} from './types.ts';

export function selectionFromFragment<T extends Entity, S extends Selection<T>>(
  fragmentComposition: Fragment<T, S>,
  ref: FragmentRef<T['__typename']> | null,
): Set<string> {
  const paths: Array<string> = [];

  const walk = (fragmentPayload: object, prefix: string | null) => {
    for (const [key, value] of Object.entries(fragmentPayload)) {
      if (key === FragmentKind) {
        continue;
      }

      const valueType = typeof value;
      const path = prefix ? `${prefix}.${key}` : key;

      if (key === 'edges' && value && valueType === 'object') {
        const edges = value;
        if (edges.node && typeof edges.node === 'object') {
          walk(edges.node, prefix);
        }
        continue;
      } else if (key === 'node') {
        if (value && valueType === 'object') {
          walk(value, path);
        }
        continue;
      } else if (key === 'pageInfo') {
        continue;
      }

      if (valueType === 'boolean' && value) {
        paths.push(path);
      } else if (isFragmentTag(key)) {
        if (!ref || ref[FragmentsTag]?.has(key)) {
          walk(value.select, prefix);
        }
      } else if (value && valueType === 'object') {
        walk(value, path);
      }
    }
  };

  for (const fragmentPayload of getFragmentPayloads(fragmentComposition, ref)) {
    walk(fragmentPayload.select, null);
  }

  return new Set(paths);
}
