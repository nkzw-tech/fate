import { aliasedField, isAliasedSelection } from './alias.ts';
import {
  applyArgsPayloadToPlan,
  combineArgsPayload,
  hashConnectionArgs,
  hashArgs,
  resolvedArgsFromPlan,
} from './args.ts';
import { getListWindowKey } from './list.ts';
import { getRootViewNames } from './ref.ts';
import { getSelectionPlan, type SelectionPlan } from './selection.ts';
import { getListKey } from './store.ts';
import type { ResolvedArgsPayload } from './transport.ts';
import {
  isNodeItem,
  isNodesItem,
  isQueryItem,
  isValueItem,
  isViewTag,
  type AnyRecord,
  type Request,
  type View,
} from './types.ts';
import { getViewNames } from './view.ts';

const isNonFiniteId = (id: string | number) => typeof id === 'number' && !Number.isFinite(id);

// JSON preserves strings and finite numbers as-is, but maps NaN and infinities to null.
const serializeIds = (ids: ReadonlyArray<string | number>) =>
  ids.some(isNonFiniteId) ? ids.map((id) => (isNonFiniteId(id) ? [String(id)] : id)) : ids;

export const getViewSignature = (view: unknown): string => {
  const viewNames = new Set<string>();
  const seen = new Set<object>();

  const collect = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value)) {
      return;
    }

    seen.add(value);

    for (const [key, entry] of Object.entries(value)) {
      if (isViewTag(key)) {
        viewNames.add(key);
      }

      collect(entry);
    }
  };

  collect(view);

  return viewNames.size ? [...viewNames].sort().join(',') : '';
};

const getRootDescriptorKey = (
  name: string,
  argsPayload: ResolvedArgsPayload | undefined,
  plan: SelectionPlan,
): string => {
  if (!argsPayload) {
    return name;
  }

  return getListKey('__root__', name, plan.args.get('')?.hash ?? hashArgs(argsPayload));
};

const getRootListDescriptorKey = (
  name: string,
  argsPayload: ResolvedArgsPayload | undefined,
  plan: SelectionPlan,
): string => {
  if (!argsPayload) {
    return name;
  }

  return getListKey('__root__', name, plan.args.get('')?.hash ?? hashConnectionArgs(argsPayload));
};

export const hasCursorArgs = (argsPayload: ResolvedArgsPayload | undefined): boolean =>
  Boolean(
    argsPayload &&
    (argsPayload.after != null || argsPayload.before != null || argsPayload.cursor != null),
  );

export type NodeRequestDescriptor = Readonly<{
  argsKey?: string;
  ids: ReadonlyArray<string | number>;
  kind: 'node' | 'nodes';
  name: string;
  plan: SelectionPlan;
  refViewNames: ReadonlySet<string>;
  type: string;
  viewSignature: string;
}>;

export type QueryRequestDescriptor = Readonly<{
  argsPayload: ResolvedArgsPayload | undefined;
  kind: 'query';
  legacyQueryKey?: string;
  name: string;
  plan: SelectionPlan;
  procedure: string;
  queryKey: string;
  refViewNames: ReadonlySet<string>;
  rootArgs: ResolvedArgsPayload | undefined;
  type: string;
  viewSignature: string;
}>;

export type ValueRequestDescriptor = Readonly<{
  argsPayload: ResolvedArgsPayload | undefined;
  kind: 'value';
  name: string;
  plan: SelectionPlan;
  procedure: string;
  queryKey: string;
  refViewNames: ReadonlySet<string>;
  type: string;
}>;

export type ListRequestDescriptor = Readonly<{
  argsPayload: ResolvedArgsPayload | undefined;
  hasItems: boolean;
  kind: 'list';
  listKey: string;
  name: string;
  nodeRefViewNames: ReadonlySet<string>;
  plan: SelectionPlan;
  procedure: string;
  type: string;
  viewSignature: string;
}>;

export const getRootListWindowKey = (item: ListRequestDescriptor): string =>
  getListWindowKey(
    item.argsPayload,
    JSON.stringify([item.name, item.viewSignature, [...item.plan.paths].sort()]),
  );

export type RequestItemDescriptor =
  | NodeRequestDescriptor
  | QueryRequestDescriptor
  | ValueRequestDescriptor
  | ListRequestDescriptor;

export type RequestDescriptor = Readonly<{
  items: ReadonlyArray<RequestItemDescriptor>;
  key: string;
}>;

export const getPaginationArgsInfo = (
  argsPayload: ResolvedArgsPayload | undefined,
): { direction: 'backward' | 'forward'; hasCursorArg: boolean } => ({
  direction: argsPayload?.before != null || argsPayload?.last != null ? 'backward' : 'forward',
  hasCursorArg: hasCursorArgs(argsPayload),
});

const getRequestDescriptorKey = (items: ReadonlyArray<RequestItemDescriptor>): string => {
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
  return JSON.stringify(
    sorted.map((item) => {
      const paths = [...item.plan.paths].sort();
      if ('ids' in item) {
        return [
          item.kind,
          item.name,
          item.type,
          item.viewSignature,
          serializeIds(item.ids),
          item.argsKey ?? null,
          paths,
        ];
      }
      return [
        item.kind,
        item.name,
        item.procedure,
        item.kind === 'value' ? null : item.viewSignature,
        item.kind === 'list' ? item.hasItems : null,
        item.argsPayload ? hashArgs(item.argsPayload) : null,
        paths,
      ];
    }),
  );
};

export const createRequestDescriptor = (
  request: Request,
  getRootType: (name: string) => string,
): RequestDescriptor => {
  const items: Array<RequestItemDescriptor> = [];

  for (const [name, rawItem] of Object.entries(request)) {
    const item = isAliasedSelection(rawItem) ? rawItem.selection : rawItem;
    const procedure = isAliasedSelection(rawItem) ? rawItem.field : name;
    if (isAliasedSelection(rawItem)) {
      aliasedField(name, procedure);
    }
    const type = getRootType(procedure);

    if (isValueItem(item)) {
      const plan =
        item.value === true
          ? { args: new Map(), live: new Map(), paths: new Set<string>() }
          : getSelectionPlan(item.value as View<any, any>, null);
      items.push({
        argsPayload: item.args,
        kind: 'value',
        name,
        plan,
        procedure,
        queryKey: `${getRootDescriptorKey(procedure, item.args, plan)}#${[...plan.paths].sort().join(',')}`,
        refViewNames: new Set(),
        type,
      });
      continue;
    }

    const node = isNodeItem(item);
    if (node || isNodesItem(item)) {
      const plan = getSelectionPlan(item.view, null);
      const args = resolvedArgsFromPlan(plan);
      items.push({
        ...(args ? { argsKey: hashArgs(args) } : {}),
        ids: node ? [item.id] : item.ids,
        kind: node ? 'node' : 'nodes',
        name,
        plan,
        refViewNames: getViewNames(item.view),
        type,
        viewSignature: getViewSignature(item.view),
      });
      continue;
    }

    if (isQueryItem(item)) {
      const { argsPayload, plan } = resolveSelectionPlan(item.view, item.args);
      const rootArgs = combineArgsPayload(item.args, plan.args.get('')?.value);
      const queryKey = getRootDescriptorKey(procedure, rootArgs, plan);
      const legacyQueryKey = getRootDescriptorKey(procedure, argsPayload, plan);
      items.push({
        argsPayload,
        kind: 'query',
        ...(legacyQueryKey !== queryKey ? { legacyQueryKey } : {}),
        name,
        plan,
        procedure,
        queryKey,
        refViewNames: getRootViewNames(item.view),
        rootArgs,
        type,
        viewSignature: getViewSignature(item.view),
      });
      continue;
    }

    const { argsPayload, plan } = resolveSelectionPlan(item.list, item.args);
    const hasItems = item.list && typeof item.list === 'object' && 'items' in item.list;
    const nodeView = (
      hasItems && item.list.items ? ((item.list.items as AnyRecord).node ?? item.list) : item.list
    ) as View<any, any>;

    items.push({
      argsPayload,
      hasItems,
      kind: 'list',
      listKey: getRootListDescriptorKey(procedure, argsPayload, plan),
      name,
      nodeRefViewNames: getRootViewNames(nodeView),
      plan,
      procedure,
      type,
      viewSignature: getViewSignature(item.list),
    });
  }

  return {
    items,
    key: getRequestDescriptorKey(items),
  };
};

export const resolveSelectionPlan = (view: View<any, any>, args: AnyRecord | undefined) => {
  const plan = getSelectionPlan(view, null);
  const argsPayload = combineArgsPayload(args, resolvedArgsFromPlan(plan));
  if (argsPayload) {
    applyArgsPayloadToPlan(plan, argsPayload);
  }
  return { argsPayload, plan };
};
