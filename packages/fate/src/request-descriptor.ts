import {
  applyArgsPayloadToPlan,
  combineArgsPayload,
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
  name: string;
  plan: SelectionPlan;
  queryKey: string;
  refViewNames: ReadonlySet<string>;
  type: string;
  viewSignature: string;
}>;

export type ListRequestDescriptor = Readonly<{
  argsPayload: ResolvedArgsPayload | undefined;
  hasItems: boolean;
  kind: 'list';
  listKey: string;
  name: string;
  nodeRefViewNames: ReadonlySet<string>;
  plan: SelectionPlan;
  type: string;
  viewSignature: string;
}>;

export type RequestItemDescriptor =
  | NodeRequestDescriptor
  | QueryRequestDescriptor
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
      parts.push(`node:${item.name}:${item.viewSignature}:${item.ids[0]}`);
      continue;
    }

    if (item.kind === 'nodes') {
      parts.push(`node:${item.name}:${item.viewSignature}:${item.ids.map(serializeId).join(',')}`);
      continue;
    }

    if (item.kind === 'query') {
      parts.push(
        `query:${item.name}:${item.viewSignature}:${
          item.argsPayload ? hashArgs(item.argsPayload) : ''
        }`,
      );
      continue;
    }

    if (item.kind === 'list') {
      parts.push(
        `list:${item.name}:${item.viewSignature}:${
          item.argsPayload ? hashArgs(item.argsPayload) : ''
        }`,
      );
    }
  }

  return parts.join('$');
};

export const createRequestDescriptor = (
  request: Request,
  getRootType: (name: string) => string,
): RequestDescriptor => {
  const items: Array<RequestItemDescriptor> = [];

  for (const [name, item] of Object.entries(request)) {
    const type = getRootType(name);

    if (isNodeItem(item)) {
      items.push({
        ids: [item.id],
        kind: 'node',
        name,
        plan: getSelectionPlan(item.view, null),
        refViewNames: new Set(getViewNames(item.view)),
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
        refViewNames: new Set(getViewNames(item.view)),
        type,
        viewSignature: getViewSignature(item.view),
      });
      continue;
    }

    if (isQueryItem(item)) {
      const { argsPayload, plan } = resolveSelectionPlan(item.view, item.args);
      items.push({
        argsPayload,
        kind: 'query',
        name,
        plan,
        queryKey: getRootDescriptorKey(name, argsPayload, plan),
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
      listKey: getRootDescriptorKey(name, argsPayload, plan),
      name,
      nodeRefViewNames: getRootViewNames(nodeView),
      plan,
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
