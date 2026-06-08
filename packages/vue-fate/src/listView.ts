import {
  ConnectionTag,
  isViewTag,
  type ConnectionMetadata,
  type Pagination,
  type View,
} from '@nkzw/fate';

export type ConnectionItems<C> = C extends { items?: ReadonlyArray<infer Item> }
  ? ReadonlyArray<Item>
  : ReadonlyArray<never>;

export type LoadMoreFn = () => Promise<void>;

export type ConnectionSelection = { items?: { node?: unknown } };

export const getNodeView = (view: ConnectionSelection): View<any, any> => {
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

export const getConnectionMetadata = (
  connection: { items?: ReadonlyArray<any>; pagination?: Pagination } | null | undefined,
) =>
  connection && typeof connection === 'object'
    ? ((connection as Record<symbol, unknown>)[ConnectionTag] as ConnectionMetadata | undefined)
    : null;
