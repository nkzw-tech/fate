import {
  isViewTag,
  ViewKind,
  ViewRef,
  ViewsTag,
  type Entity,
  type Selection,
  type View,
} from './types.ts';
import { getViewPayloads } from './view.ts';

export function selectionFromView<T extends Entity, S extends Selection<T>>(
  viewComposition: View<T, S>,
  ref: ViewRef<T['__typename']> | null,
): Set<string> {
  const paths = new Set<string>();

  const walk = (viewPayload: object, prefix: string | null) => {
    for (const [key, value] of Object.entries(viewPayload)) {
      if (key === ViewKind) {
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
        paths.add(path);
      } else if (isViewTag(key)) {
        if (!ref || ref[ViewsTag]?.has(key)) {
          walk(value.select, prefix);
        }
      } else if (value && valueType === 'object') {
        walk(value, path);
      }
    }
  };

  for (const viewPayload of getViewPayloads(viewComposition, ref)) {
    walk(viewPayload.select, null);
  }

  return paths;
}
