import { cloneArgs, hashArgs, paginationArgKeys } from './args.ts';
import { isRecord } from './record.ts';
import {
  AnyRecord,
  isViewTag,
  ViewRef,
  ViewsTag,
  type ConnectionLivePolicy,
  type Entity,
  type Selection,
  type View,
} from './types.ts';
import { getViewPayloads } from './view.ts';

type WalkContext = 'default' | 'connection';

/**
 * Representation of a composed selection including hashed args and the
 * flat set of field paths to read or fetch.
 */
export type SelectionPlan = {
  readonly args: Map<
    string,
    Readonly<{ hash: string; ignoreKeys?: ReadonlySet<string>; value: AnyRecord }>
  >;
  readonly live: Map<string, ConnectionLivePolicy>;
  readonly paths: Set<string>;
};

const isConnectionSelection = (value: AnyRecord): boolean =>
  isRecord(value.items) && 'node' in value.items;

/**
 * Flattens a view into a `SelectionPlan`, expanding composed views and
 * partitioning nested args so the client can fetch exactly what is declared.
 */
export const getSelectionPlan = <T extends Entity, S extends Selection<T>, V extends View<T, S>>(
  viewComposition: V,
  ref: ViewRef<T['__typename']> | null,
): SelectionPlan => {
  const args = new Map<
    string,
    { hash: string; ignoreKeys?: ReadonlySet<string>; value: AnyRecord }
  >();
  const live = new Map<string, ConnectionLivePolicy>();
  const paths = new Set<string>();

  const assignArgs = (path: string, value: AnyRecord, ignoreKeys?: ReadonlySet<string>) => {
    const hash = hashArgs(value, { ignoreKeys });
    args.set(path, { hash, ignoreKeys, value });
  };

  const walk = (selection: AnyRecord, prefix: string | null, context: WalkContext = 'default') => {
    if (prefix === null && context !== 'connection' && isConnectionSelection(selection)) {
      if (selection.live && isRecord(selection.live)) {
        live.set('', {
          append: selection.live.append === 'visible' ? 'visible' : 'edge',
          prepend: selection.live.prepend === 'visible' ? 'visible' : 'edge',
        });
      }
      if (selection.args && isRecord(selection.args)) {
        const clonedArgs = cloneArgs(selection.args, 'args');
        const ignoreKeys =
          isRecord(selection.items) && isRecord(selection.items.node)
            ? paginationArgKeys
            : undefined;
        assignArgs('', clonedArgs, ignoreKeys);
      }

      const { args, live: _live, ...withoutArgs } = selection;
      walk(withoutArgs, prefix, 'connection');
      return;
    }

    for (const [key, value] of Object.entries(selection)) {
      const valueType = typeof value;
      const path = prefix ? `${prefix}.${key}` : key;

      if (context === 'connection') {
        if (key === 'args' || key === 'live' || key === 'pagination') {
          continue;
        }

        if (key === 'items' && isRecord(value)) {
          if (isRecord(value.node)) {
            walk(value.node, prefix);
          }
          continue;
        }
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
          if (selectionObject.live && isRecord(selectionObject.live)) {
            live.set(path, {
              append: selectionObject.live.append === 'visible' ? 'visible' : 'edge',
              prepend: selectionObject.live.prepend === 'visible' ? 'visible' : 'edge',
            });
          }
          if (selectionObject.args && isRecord(selectionObject.args)) {
            const clonedArgs = cloneArgs(selectionObject.args, path);
            const ignoreKeys =
              isRecord(selectionObject.items) && isRecord(selectionObject.items.node)
                ? paginationArgKeys
                : undefined;
            assignArgs(path, clonedArgs, ignoreKeys);
          }

          const { args: _ignored, live: _live, ...withoutArgs } = selectionObject;
          walk(withoutArgs, path, 'connection');
          continue;
        }

        const hasArgs = selectionObject.args && isRecord(selectionObject.args);
        let selectionWithoutArgs = selectionObject;
        if (hasArgs) {
          const clonedArgs = cloneArgs(selectionObject.args as AnyRecord, path);
          const ignoreKeys =
            isRecord(selectionObject.items) && isRecord(selectionObject.items?.node)
              ? paginationArgKeys
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

  const payloads = getViewPayloads(viewComposition, ref);
  if (payloads.length === 0 && isRecord(viewComposition)) {
    walk(viewComposition, null);
  } else {
    for (const payload of payloads) {
      walk(payload.select, null);
    }
  }

  return { args, live, paths };
};
