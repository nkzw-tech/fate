import { aliasedField, isAliasedSelection } from './alias.ts';
import {
  applyArgsPayloadToPlan,
  combineArgsPayload,
  filterConnectionArgs,
  hashArgs,
  resolvedArgsFromPlan,
} from './args.ts';
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

const serializeId = (value: string | number): string => `${typeof value}:${String(value)}`;

const getViewSignature = (view: unknown): string => {
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

  return getListKey(
    '__root__',
    name,
    plan.args.get('')?.hash ?? hashArgs(filterConnectionArgs(argsPayload) ?? {}),
  );
};

export const hasCursorArgs = (argsPayload: ResolvedArgsPayload | undefined): boolean =>
  Boolean(
    argsPayload && ('after' in argsPayload || 'before' in argsPayload || 'cursor' in argsPayload),
  );

export type NodeRequestDescriptor = Readonly<{
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
  direction:
    argsPayload?.before !== undefined || argsPayload?.last !== undefined ? 'backward' : 'forward',
  hasCursorArg: hasCursorArgs(argsPayload),
});

const getRequestDescriptorKey = (items: ReadonlyArray<RequestItemDescriptor>): string => {
  const parts: Array<string> = [];
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));

  for (const item of sorted) {
    if (item.kind === 'node') {
      const args = resolvedArgsFromPlan(item.plan);
      parts.push(
        `node:${item.name}:${item.viewSignature}:${item.ids[0]}${args ? `:${hashArgs(args)}` : ''}`,
      );
      continue;
    }

    if (item.kind === 'nodes') {
      const args = resolvedArgsFromPlan(item.plan);
      parts.push(
        `node:${item.name}:${item.viewSignature}:${item.ids.map(serializeId).join(',')}${args ? `:${hashArgs(args)}` : ''}`,
      );
      continue;
    }

    if (item.kind === 'query' || item.kind === 'value') {
      parts.push(
        `${item.kind}:${item.name}:${item.kind === 'query' ? item.viewSignature : ''}:${
          item.argsPayload ? hashArgs(item.argsPayload) : ''
        }`,
      );
      continue;
    }

    if (item.kind === 'list') {
      parts.push(
        `list:${item.name}:${item.hasItems ? 'connection' : 'entity'}:${item.viewSignature}:${
          item.argsPayload ? hashArgs(item.argsPayload) : ''
        }`,
      );
    }
  }

  return `${parts.join('$')}|${JSON.stringify(sorted.map((item) => ['procedure' in item ? item.procedure : item.type, [...item.plan.paths].sort()]))}`;
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

    if (isNodeItem(item)) {
      items.push({
        ids: [item.id],
        kind: 'node',
        name,
        plan: getSelectionPlan(item.view, null),
        refViewNames: getViewNames(item.view),
        type,
        viewSignature: getViewSignature(item.view),
      });
      continue;
    }

    if (isNodesItem(item)) {
      items.push({
        ids: item.ids,
        kind: 'nodes',
        name,
        plan: getSelectionPlan(item.view, null),
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
