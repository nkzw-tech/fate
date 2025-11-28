import { cloneArgs, hashArgs } from './args.ts';
import { isRecord } from './record.ts';
import {
  AnyRecord,
  isViewTag,
  ViewRef,
  ViewsTag,
  type Entity,
  type Selection,
  type View,
} from './types.ts';
import { getViewPayloads } from './view.ts';

const paginationKeys = new Set(['after', 'before', 'cursor']);

type WalkContext = 'default' | 'connection';

/**
 * Representation of a composed selection including hashed args and the
 * flat set of field paths to read or fetch.
 */
export type SelectionPlan = {
  readonly args: Map<
    string,
    { hash: string; ignoreKeys?: ReadonlySet<string>; value: AnyRecord }
  >;
  readonly paths: Set<string>;
};

const isConnectionSelection = (value: AnyRecord): boolean =>
  isRecord(value.items) && 'node' in value.items;

/**
 * Flattens a view into a `SelectionPlan`, expanding composed views and
 * partitioning nested args so the client can fetch exactly what is declared.
 */
export const getSelectionPlan = <
  T extends Entity,
  S extends Selection<T>,
  V extends View<T, S>,
>(
  viewComposition: V,
  ref: ViewRef<T['__typename']> | null,
): SelectionPlan => {
  const args = new Map<
    string,
    { hash: string; ignoreKeys?: ReadonlySet<string>; value: AnyRecord }
  >();
  const paths = new Set<string>();

  const assignArgs = (
    path: string,
    value: AnyRecord,
    ignoreKeys?: ReadonlySet<string>,
  ) => {
    const hash = hashArgs(value, { ignoreKeys });
    args.set(path, { hash, ignoreKeys, value });
  };

  const walk = (
    selection: AnyRecord,
    prefix: string | null,
    context: WalkContext = 'default',
  ) => {
    for (const [key, value] of Object.entries(selection)) {
      const valueType = typeof value;
      const path = prefix ? `${prefix}.${key}` : key;

      if (context === 'connection') {
        if (key === 'args' || key === 'pagination') {
          continue;
        }

        if (key === 'items' && isRecord(value)) {
          if (isRecord(value.node)) {
            walk(value.node, prefix);
          }
          continue;
        }

        if (key === 'node' && isRecord(value)) {
          walk(value, path);
          continue;
        }
      }

      if (key === 'node' && isRecord(value)) {
        walk(value, path);
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

      if (isRecord(value)) {
        const selectionObject = value;

        if (isConnectionSelection(selectionObject)) {
          if (selectionObject.args && isRecord(selectionObject.args)) {
            const clonedArgs = cloneArgs(selectionObject.args, path);
            const ignoreKeys =
              isRecord(selectionObject.items) &&
              isRecord(selectionObject.items.node)
                ? paginationKeys
                : undefined;
            assignArgs(path, clonedArgs, ignoreKeys);
          }

          const { args: _ignored, ...withoutArgs } = selectionObject;
          walk(withoutArgs, path, 'connection');
          continue;
        }

        const hasArgs = selectionObject.args && isRecord(selectionObject.args);
        let selectionWithoutArgs = selectionObject;
        if (hasArgs) {
          const clonedArgs = cloneArgs(selectionObject.args as AnyRecord, path);
          const ignoreKeys =
            isRecord(selectionObject.items) &&
            isRecord(selectionObject.items?.node)
              ? paginationKeys
              : undefined;
          assignArgs(path, clonedArgs, ignoreKeys);
          const { args, ...rest } = selectionObject;
          selectionWithoutArgs = rest;
        }

        const hasEntries = Object.keys(selectionWithoutArgs).length > 0;
        if (hasEntries) {
          walk(selectionWithoutArgs, path);
        } else if (hasArgs) {
          paths.add(path);
        }
      }
    }
  };

  for (const payload of getViewPayloads(viewComposition, ref)) {
    walk(payload.select, null);
  }

  return { args, paths };
};
