import { aliasedField, isAliasedSelection, isAliasedView, responseField } from './alias.ts';
import { cloneArgs, getConnectionWindowIgnoreKeys, hashArgs, hashConnectionArgs } from './args.ts';
import { isDeferredSelection } from './defer.ts';
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
import { resolveConditionalSelection } from './when.ts';

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
  options?: { includeNestedViews?: boolean },
): SelectionPlan => {
  const args = new Map<
    string,
    { hash: string; ignoreKeys?: ReadonlySet<string>; value: AnyRecord }
  >();
  const live = new Map<string, ConnectionLivePolicy>();
  const paths = new Set<string>();
  const responsePaths = new Map<string, string>();

  const assignArgs = (path: string, value: AnyRecord, ignoreKeys?: ReadonlySet<string>) => {
    const previous = args.get(path);
    if (previous && hashArgs(previous.value) !== hashArgs(value)) {
      throw new Error(`fate: Conflicting arguments for '${path}'. Use distinct aliases.`);
    }
    const hash = ignoreKeys ? hashConnectionArgs(value, ignoreKeys) : hashArgs(value);
    args.set(path, { hash, ignoreKeys, value });
  };

  const walk = (
    selection: AnyRecord,
    prefix: string | null,
    context: WalkContext = 'default',
    namespace: ReadonlyArray<string> = [],
  ) => {
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
            ? getConnectionWindowIgnoreKeys(clonedArgs)
            : undefined;
        assignArgs('', clonedArgs, ignoreKeys);
      }

      const { args: _args, live: _live, ...withoutArgs } = selection;
      walk(withoutArgs, prefix, 'connection', namespace);
      return;
    }

    for (const [key, conditionalValue] of Object.entries(selection)) {
      const rawValue = resolveConditionalSelection(conditionalValue);
      if (rawValue === undefined) {
        continue;
      }
      if (isAliasedView(rawValue)) {
        aliasedField(key, key);
        for (const payload of getViewPayloads(rawValue.view, null)) {
          walk(payload.select, prefix, context, [...namespace, key]);
        }
        continue;
      }
      const value = isAliasedSelection(rawValue) ? rawValue.selection : rawValue;
      const sourceField = isAliasedSelection(rawValue) ? rawValue.field : key;
      const resultField = isAliasedSelection(rawValue) ? aliasedField(key, sourceField) : key;
      // Alias the first schema field of each named fragment. Its children share the
      // usual normalized schema-field/argument keys when the response is written.
      const field =
        namespace.length && !isViewTag(key)
          ? `fate_fragment_${[...namespace, key].map((part) => `${part.length}_${part}`).join('_')}:${sourceField}`
          : resultField;
      const valueType = typeof value;
      if (valueType === 'function') {
        throw new Error('fate: Bind the view parameters before using a view in a selection.');
      }
      const path = prefix ? `${prefix}.${field}` : field;

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

      if (!isViewTag(key) && !isDeferredSelection(value)) {
        const responsePath = path.split('.').map(responseField).join('.');
        const previous = responsePaths.get(responsePath);
        if (previous && previous !== path) {
          throw new Error(`fate: Conflicting alias selections for '${responsePath}'.`);
        }
        responsePaths.set(responsePath, path);
      }

      if (valueType === 'boolean') {
        if (value) {
          paths.add(path);
        }
        continue;
      }

      if (isDeferredSelection(value)) {
        continue;
      }

      if (isViewTag(key)) {
        if (options?.includeNestedViews || !ref || ref[ViewsTag]?.has(key)) {
          walk((value as { select: AnyRecord }).select, prefix, context, namespace);
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
                ? getConnectionWindowIgnoreKeys(clonedArgs)
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
              ? getConnectionWindowIgnoreKeys(clonedArgs)
              : undefined;
          assignArgs(path, clonedArgs, ignoreKeys);
          const { args: _args, ...rest } = selectionObject;
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

export const getDeferredSelectionPlan = (field: string, selection: unknown): SelectionPlan => {
  const syntheticView = { [field]: selection } as View<any, any>;
  return getSelectionPlan(syntheticView, null);
};
