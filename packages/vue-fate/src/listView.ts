import {
  ConnectionTag,
  type Deferred,
  isViewTag,
  type ConnectionMetadata,
  type Pagination,
  type View,
} from '@nkzw/fate';

export type ConnectionValue = { items?: ReadonlyArray<any>; pagination?: Pagination };
export type ResolvedConnection<C> = C extends Deferred<infer Value> ? Value : C;

export type ConnectionItems<C> = C extends { items?: ReadonlyArray<infer Item> }
  ? ReadonlyArray<Item> | Extract<C['items'], undefined>
  : undefined;

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
