import {
  ConnectionTag,
  type Deferred,
  isViewTag,
  type ConnectionMetadata,
  type Pagination,
  type View,
} from '@nkzw/fate';
import { useMemo } from 'react';

export type ConnectionValue = { items?: ReadonlyArray<any>; pagination?: Pagination };
export type ResolvedConnection<C> = C extends Deferred<infer Value> ? Value : C;

export type ConnectionItems<C> = C extends { items?: ReadonlyArray<infer Item> }
  ? ReadonlyArray<Item> | Extract<C['items'], undefined>
  : undefined;

export type LoadMoreFn = () => Promise<void>;

export type ConnectionSelection = { items?: { node?: unknown } };

const getNodeView = (view: ConnectionSelection): View<any, any> => {
  const maybeView = view.items?.node;

  if (maybeView && typeof maybeView === 'object') {
    for (const key of Object.keys(maybeView)) {
      if (isViewTag(key)) {
        return maybeView as View<any, any>;
      }
    }
  }

  return view as View<any, any>;
};

const getConnectionMetadata = (
  connection: { items?: ReadonlyArray<any>; pagination?: Pagination } | null | undefined,
) =>
  connection && typeof connection === 'object'
    ? ((connection as Record<symbol, unknown>)[ConnectionTag] as ConnectionMetadata | undefined)
    : null;

export const useListViewInfo = (
  selection: ConnectionSelection,
  connection: { items?: ReadonlyArray<any>; pagination?: Pagination } | null | undefined,
) => ({
  metadata: getConnectionMetadata(connection),
  nodeView: useMemo(() => getNodeView(selection), [selection]),
});
