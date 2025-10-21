import type { Entity, Fragment, Selection } from './types.ts';

export function pathsFromSelection(
  selection?: Selection<Entity>,
): Array<string> | undefined {
  if (!selection) {
    return undefined;
  }
  const result: Array<string> = [];

  const walk = (node: Record<string, unknown>, prefix: string | null) => {
    for (const key of Object.keys(node)) {
      const value = node[key];
      const path = prefix ? `${prefix}.${key}` : key;
      if (value === true) {
        result.push(path);
      } else if (value && typeof value === 'object') {
        walk(value as Record<string, unknown>, path);
      }
    }
  };

  walk(selection, null);
  return result;
}

export function selectFromFragment<T extends Entity, S extends Selection<T>>(
  fragment: Fragment<T, S>,
): Array<string> | undefined {
  return pathsFromSelection(fragment.select);
}
