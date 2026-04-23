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

const getRequestArgsSignature = (view: View<any, any>, args?: AnyRecord): string => {
  const plan = getSelectionPlan(view, null);
  const argsPayload = combineArgsPayload(args, resolvedArgsFromPlan(plan));
  if (!argsPayload) {
    return '';
  }

  return hashArgs(argsPayload);
};

const getRootListKey = (
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

export const getRequestCacheKey = (request: Request) => {
  const parts: Array<string> = [];
  const names = Object.keys(request).sort();

  for (const name of names) {
    const item = request[name];
    if (!item) {
      continue;
    }

    if (isNodeItem(item)) {
      parts.push(`node:${name}:${getViewSignature(item.view)}:${item.id}`);
      continue;
    }

    if (isNodesItem(item)) {
      parts.push(
        `node:${name}:${getViewSignature(item.view)}:${item.ids.map(serializeId).join(',')}`,
      );
      continue;
    }

    if (isQueryItem(item)) {
      parts.push(
        `query:${name}:${getViewSignature(item.view)}:${getRequestArgsSignature(
          item.view,
          item.args,
        )}`,
      );
      continue;
    }

    parts.push(
      `list:${name}:${getViewSignature(item.list)}:${getRequestArgsSignature(
        item.list,
        item.args,
      )}`,
    );
  }

  return parts.join('$');
};

export type NodeRequestDescriptor = Readonly<{
  ids: ReadonlyArray<string | number>;
  kind: 'node' | 'nodes';
  name: string;
  plan: SelectionPlan;
  refViewNames: ReadonlySet<string>;
  type: string;
}>;

export type QueryRequestDescriptor = Readonly<{
  argsPayload: ResolvedArgsPayload | undefined;
  kind: 'query';
  name: string;
  plan: SelectionPlan;
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
  type: string;
}>;

export type RequestItemDescriptor =
  | NodeRequestDescriptor
  | QueryRequestDescriptor
  | ListRequestDescriptor;

export type RequestDescriptor = Readonly<{
  items: ReadonlyArray<RequestItemDescriptor>;
  key: string;
}>;

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
      });
      continue;
    }

    if (isQueryItem(item)) {
      const { argsPayload, plan } = resolveSelection(item.view, item.args);
      items.push({
        argsPayload,
        kind: 'query',
        name,
        plan,
        refViewNames: getRootViewNames(item.view),
        type,
      });
      continue;
    }

    const { argsPayload, plan } = resolveSelection(item.list, item.args);
    const hasItems = item.list && typeof item.list === 'object' && 'items' in item.list;
    const nodeView = (
      hasItems && item.list.items ? ((item.list.items as AnyRecord).node ?? item.list) : item.list
    ) as View<any, any>;

    items.push({
      argsPayload,
      hasItems,
      kind: 'list',
      listKey: getRootListKey(name, argsPayload, plan),
      name,
      nodeRefViewNames: getRootViewNames(nodeView),
      plan,
      type,
    });
  }

  return {
    items,
    key: getRequestCacheKey(request),
  };
};

const resolveSelection = (view: View<any, any>, args: AnyRecord | undefined) => {
  const plan = getSelectionPlan(view, null);
  const argsPayload = combineArgsPayload(args, resolvedArgsFromPlan(plan));
  if (argsPayload) {
    applyArgsPayloadToPlan(plan, argsPayload);
  }
  return { argsPayload, plan };
};
