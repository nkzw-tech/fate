import { hashArgs, isArgs, resolveArgs } from './args.ts';
import {
  AnyRecord,
  isViewTag,
  ViewKind,
  ViewRef,
  ViewsTag,
  type Entity,
  type Selection,
  type View,
} from './types.ts';
import { getViewPayloads } from './view.ts';

const paginationKeys = new Set(['after', 'before', 'cursor']);

export type SelectionPlan = {
  readonly args: Map<string, { hash: string; value: AnyRecord }>;
  readonly paths: Set<string>;
};

const isPlainObject = (value: unknown): value is AnyRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const selectionFromView = <
  T extends Entity,
  S extends Selection<T>,
  V extends View<T, S>,
>(
  viewComposition: V,
  ref: ViewRef<T['__typename']> | null,
  rootArgs: AnyRecord = {},
): SelectionPlan => {
  const args = new Map<string, { hash: string; value: AnyRecord }>();
  const paths = new Set<string>();

  const assignArgs = (
    path: string,
    value: ReturnType<typeof resolveArgs>,
    ignoreKeys?: ReadonlySet<string>,
  ) => {
    const hash = hashArgs(value, { ignoreKeys });
    args.set(path, { hash, value });
  };

  const walk = (selection: AnyRecord, prefix: string | null) => {
    for (const [key, value] of Object.entries(selection)) {
      if (key === ViewKind) {
        continue;
      }

      const valueType = typeof value;
      const path = prefix ? `${prefix}.${key}` : key;

      if (key === 'items' && isPlainObject(value)) {
        if (isPlainObject(value.node)) {
          walk(value.node, prefix);
        }
        continue;
      }

      if (key === 'node' && isPlainObject(value)) {
        walk(value, path);
        continue;
      }

      if (key === 'pagination') {
        continue;
      }

      if (valueType === 'boolean') {
        if (value) {
          paths.add(path);
        }
        continue;
      }

      if (isViewTag(key)) {
        if (!ref || (ref[ViewsTag] && ref[ViewsTag].has(key))) {
          walk((value as { select: AnyRecord }).select, prefix);
        }
        continue;
      }

      if (isArgs(value)) {
        assignArgs(path, resolveArgs(value, { args: rootArgs, path }));
        paths.add(path);
        continue;
      }

      if (isPlainObject(value)) {
        if (isArgs(value.args)) {
          assignArgs(
            path,
            resolveArgs(value.args, { args: rootArgs, path }),
            isPlainObject(value.items) && isPlainObject(value.items.node)
              ? paginationKeys
              : undefined,
          );
        }

        walk(value, path);
      }
    }
  };

  for (const payload of getViewPayloads(viewComposition, ref)) {
    walk(payload.select, null);
  }

  return { args, paths };
};
