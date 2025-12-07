import { FieldMask } from './mask.ts';
import { FateMutations } from './mutation.ts';

/** Canonical runtime name for an entity type as returned by the server. */
export type TypeName = string;

/** Globally unique identifier for an entity in the normalized cache (`<TypeName>:<id>` format). */
export type EntityId = string;

/** Internal marker added to objects that represent a view payload. */
export const ViewKind = Symbol('__fate__view');

/** Symbol used to attach the set of view tags that were spread into a ref or masked record. */
export const ViewsTag = Symbol('__fate__views');

/** Symbol used to brand a value as a node reference inside the cache. */
export const NodeRefTag = Symbol('__fate__node-ref');

/** Symbol attached to connection results so pagination helpers can find their metadata. */
export const ConnectionTag = Symbol('__fate__connection');

export declare const __FateEntityBrand: unique symbol;
export declare const __FateSelectionBrand: unique symbol;
export declare const __FateMutationEntityBrand: unique symbol;
export declare const __FateMutationInputBrand: unique symbol;
export declare const __FateMutationResultBrand: unique symbol;

type __ViewEntityAnchor<T extends Entity> = {
  readonly [__FateEntityBrand]?: T;
};
type __ViewSelectionAnchor<S> = {
  [__FateSelectionBrand]?: S;
};
type __MutationEntityAnchor<T extends Entity> = {
  readonly [__FateMutationEntityBrand]?: T;
};
type __MutationInputAnchor<I> = {
  readonly [__FateMutationInputBrand]?: I;
};
type __MutationResultAnchor<R> = {
  readonly [__FateMutationResultBrand]?: R;
};

/** Unique key that identifies a view composition entry inside a selection or reference. */
export type ViewTag = `__fate-view__${string}`;

const viewTag = '__fate-view__' as const;

/** Generates a stable view tag for a view definition. */
export function getViewTag(id: string): ViewTag {
  return `${viewTag}${id}`;
}

/** Determines whether a property key is a fate view tag. */
export function isViewTag(key: string): key is ViewTag {
  return key.startsWith(viewTag);
}

/** Alias for a loose record used throughout the fate's internals. */
export type AnyRecord = Record<string, unknown>;

type SelectionArgs = Readonly<{ args: AnyRecord }>;

/** Metadata stored alongside connection results to power pagination and cache updates. */
export type ConnectionMetadata = Readonly<{
  args?: AnyRecord;
  field: string;
  hash?: string;
  key: string;
  owner: EntityId;
  procedure: string;
  root?: boolean;
  type: string;
}>;

/** A fully resolved view payload augmented with the set of view tags applied to it. */
export type ViewResult = AnyRecord & {
  readonly [ViewsTag]?: Set<string>;
};

/** Reference to a normalized entity instance that can be resolved against one or more view tags. */
export type ViewRef<TName extends string> = Readonly<{
  __typename: TName;
  id: string | number;
  [ViewsTag]: Set<string>;
}>;

/** Describes how a field relates to another entity for normalization. */
export type RelationDescriptor =
  /** Field stores a scalar value that does not link to another type. */
  | 'scalar'
  /** Field points to a single entity of the given type. */
  | { type: string }
  /** Field holds a list of entities of the given type. */
  | { listOf: string };

/** Configuration for a server entity type used by the client cache. */
export type TypeConfig = {
  fields?: Record<string, RelationDescriptor>;
  getId: (record: unknown) => string | number;
  type: string;
};

/** Pagination state returned alongside connection lists. */
export type Pagination = {
  hasNext: boolean;
  hasPrevious: boolean;
  nextCursor?: string;
  previousCursor?: string;
};

/** Ref for a connection, including pagination metadata. */
export type ConnectionRef<TName extends string> = Readonly<{
  items: ReadonlyArray<{
    cursor?: string;
    node: ViewRef<TName>;
  }>;
  pagination?: Pagination;
}>;

/** Base shape shared by all entities fetched by fate. */
export type Entity = { __typename: string };

type PlainObjectSelectionField<V> =
  V extends Array<infer U>
    ? PlainObjectSelectionField<U> | true
    : V extends AnyRecord
      ? PlainObjectSelection<V> | true
      : true;

type PlainObjectSelection<T> = {
  [K in keyof T]?: PlainObjectSelectionField<T[K]>;
};

type ConnectionSelectionBase<T extends Entity> = Readonly<{
  items: Readonly<{
    cursor?: true;
    node: Selection<T> | View<T, Selection<T>>;
  }>;
  pagination?: Readonly<{
    hasNext?: true;
    hasPrevious?: true;
    nextCursor?: true;
    previousCursor?: true;
  }>;
}>;

/** Selection shape for a connection-style list, including pagination metadata and optional arguments. */
export type ConnectionSelection<T extends Entity> =
  | ConnectionSelectionBase<T>
  | (SelectionArgs & ConnectionSelectionBase<T>);

type BaseSelectionFieldValue<T extends Entity, K extends keyof T> =
  NonNullable<T[K]> extends Array<infer U extends Entity>
    ? true | Selection<U> | ConnectionSelection<U> | View<U, Selection<U>>
    : NonNullable<T[K]> extends Entity
      ? true | Selection<NonNullable<T[K]>> | View<NonNullable<T[K]>, Selection<NonNullable<T[K]>>>
      : NonNullable<T[K]> extends AnyRecord
        ? PlainObjectSelection<NonNullable<T[K]>>
        : true;

type SelectionFieldValue<T extends Entity, K extends keyof T> =
  | BaseSelectionFieldValue<T, K>
  | SelectionArgs
  | (SelectionArgs & Extract<BaseSelectionFieldValue<T, K>, object>);

type SelectionShape<T extends Entity> = {
  [K in keyof T as K extends '__typename' ? never : K]?: SelectionFieldValue<T, K>;
} & { __typename?: true };

type SelectionViewSpread<T extends Entity> = {
  readonly [K in ViewTag]?: Readonly<{
    select: Selection<T>;
    [ViewKind]: true;
  }>;
};

/** Declarative selection of the fields a view needs from an entity. */
export type Selection<T extends Entity> = SelectionShape<T> & SelectionViewSpread<T>;

/** Extracts the selection type that was used to build a view. */
export type SelectionOf<V> = V extends {
  readonly [__FateSelectionBrand]?: infer S;
}
  ? S
  : never;

/** View payload stored on a view tag containing the raw selection used to mask data. */
export type ViewPayload<T extends Entity, S extends Selection<T> = Selection<T>> = Readonly<{
  select: S;
  [ViewKind]: true;
}>;

/** Definition of a view over an entity type, including the selection of fields. */
export type View<T extends Entity, S extends Selection<T> = Selection<T>> = Readonly<{
  [viewTag: ViewTag]: ViewPayload<T, S>;
}> &
  __ViewEntityAnchor<T> &
  __ViewSelectionAnchor<S>;

type HasViewTag<S> = S extends { [K in ViewTag]?: infer P }
  ? P extends { [ViewKind]: true }
    ? true
    : false
  : false;

/**
 * Data returned from a resolved view with masking applied and view tags
 * attached for downstream composition.
 */
export type ViewData<T extends Entity, S extends Selection<T>> = Readonly<
  (S extends Selection<T> ? Mask<T, S> : T) & {
    [ViewsTag]: Set<string>;
  }
>;

/**
 * Snapshot returned by the cache for a view, including the masked data and all
 * referenced entity IDs.
 */
export type ViewSnapshot<T extends Entity, S extends Selection<T>> = Readonly<{
  coverage: ReadonlyArray<readonly [id: EntityId, paths: ReadonlySet<string>]>;
  data: ViewData<T, S>;
}>;

type ConnectionMask<T extends Entity, S> = S extends {
  items: infer ItemSelection;
  pagination?: infer PaginationSelection;
}
  ? {
      items: ItemSelection extends {
        cursor?: infer CursorSelection;
        node: unknown;
      }
        ? Array<
            (CursorSelection extends true ? { cursor: string } : Record<string, never>) & {
              node: ViewRef<T['__typename']>;
            }
          >
        : Array<{ node: ViewRef<T['__typename']> }>;
    } & (PaginationSelection extends object
      ? {
          pagination: {
            [K in keyof PaginationSelection]: Pagination[K & keyof Pagination];
          };
        }
      : Record<string, never>)
  : Array<T>;

type EntityName<T> = T extends { __typename: infer N extends string } ? N : never;

/** Recursively applies a view selection to an entity to mask fields that aren't selected. */
export type Mask<T, S> =
  T extends Array<infer U extends Entity>
    ? S extends true
      ? Array<U>
      : S extends ConnectionSelection<U>
        ? ConnectionMask<U, S>
        : HasViewTag<S> extends true
          ? Array<ViewRef<U['__typename']>>
          : Array<Mask<U, S>>
    : S extends true
      ? T
      : S extends object
        ? HasViewTag<S> extends true
          ? ViewRef<EntityName<NonNullable<T>>>
          : {
              [K in keyof S as K extends 'args' ? never : K]: S[K] extends true
                ? NonNullable<T>[Extract<K, keyof T>]
                : Mask<NonNullable<T>[Extract<K, keyof T>], Extract<S[K], object>>;
            } & (T extends Entity ? Pick<NonNullable<T>, '__typename'> : Record<never, never>)
        : T;

/** Entity type captured from a view definition. */
export type ViewEntity<V> = V extends View<infer T, any> ? T : never;

/** Name of the entity type captured from a view definition. */
export type ViewEntityName<V> = ViewEntity<V>['__typename'] & string;

/** Selection captured from a view definition. */
export type ViewSelection<V> = V extends {
  readonly [__FateSelectionBrand]?: infer S;
}
  ? S
  : never;

/** Definition of a list request for fetching data from the backend. */
export type ListItem<V extends View<any, any>> = Readonly<{
  args?: Record<string, unknown>;
  root: V;
  type: ViewEntityName<V>;
}>;

/** Definition of a node request with one explicit ID for fetching data from the backend. */
export type NodeItem<V extends View<any, any>> = Readonly<{
  id: string | number;
  root: V;
  type: ViewEntityName<V>;
}>;

/** Definition of a node request with explicit IDs for fetching data from the backend. */
export type NodesItem<V extends View<any, any>> = Readonly<{
  ids: ReadonlyArray<string | number>;
  root: V;
  type: ViewEntityName<V>;
}>;

type RequestItem = ListItem<View<any, any>> | NodeItem<View<any, any>> | NodesItem<View<any, any>>;

/** Collection of node and list requests describing the data a screen needs. */
export type Request = Record<string, RequestItem>;

type AnyView = View<any, any>;
type AnyListItem = ListItem<AnyView>;
type AnyNodeItem = NodeItem<AnyView>;
type AnyNodesItem = NodesItem<AnyView>;
type AnyRequestItem = AnyListItem | AnyNodeItem | AnyNodesItem;
type AnyRequest = Record<string, AnyRequestItem>;

/**
 * Typed result returned by `useRequest` and `FateClient.request`, mapping each
 * request key to an array of view refs for the requested type.
 */
type ConnectionNodeType<Root> = Root extends { items?: { node?: infer Node } }
  ? ViewEntityName<Node & View<any, any>>
  : never;

type ListResult<Item extends AnyRequestItem> = Item extends AnyNodeItem
  ? ViewRef<Item['type']>
  : Item extends AnyNodesItem
    ? Array<ViewRef<Item['type']>>
    : Item extends AnyListItem
      ? Item['root'] extends { items?: { node?: View<any, any> } }
        ? Readonly<{
            items: ReadonlyArray<{
              cursor?: string | undefined;
              node: ViewRef<ConnectionNodeType<Item['root']>>;
            }>;
            pagination?: Pagination;
          }>
        : Array<ViewRef<Item['type']>>
      : never;

/**
 * The result of a `FateClient.request` and `useRequest` call, mapping each
 * request key to its corresponding result.
 */
export type RequestResult<Q extends AnyRequest> = { [K in keyof Q]: ListResult<Q[K]> };

/** Indicates whether a request item represents an explicit node ID. */
export function isNodeItem(item: AnyRequestItem): item is AnyNodeItem {
  return 'id' in item;
}
/** Indicates whether a request item represents explicit node IDs. */
export function isNodesItem(item: AnyRequestItem): item is AnyNodesItem {
  return 'ids' in item;
}

/** Brand used on mutation definitions to mark their identity in the d.ts output. */
export const MutationKind = '__fate__mutation';

/** Metadata describing a mutation for a particular entity, input, and output. */
export type MutationDefinition<T extends Entity, I, R> = Readonly<{
  entity: T['__typename'];
  [MutationKind]: true;
}> &
  __MutationEntityAnchor<T> &
  __MutationInputAnchor<I> &
  __MutationResultAnchor<R>;

export type MutationIdentifier<T extends Entity, I, R> = MutationDefinition<T, I, R> &
  Readonly<{ key: string }>;

/** Extracts the input type from a mutation definition or identifier. */
export type MutationInput<M> = M extends __MutationInputAnchor<infer I> ? I : never;

/** Extracts the result type from a mutation definition or identifier. */
export type MutationResult<M> = M extends __MutationResultAnchor<infer R> ? R : never;

/** Extracts the entity type from a mutation definition or identifier. */
export type MutationEntity<M> = M extends __MutationEntityAnchor<infer E> ? E : never;

/** Minimal mutation description used for transport typing. */
export type MutationShape = { input: unknown; output: unknown };

/**
 * Convenience helper that maps mutation definitions to their input/output
 * shapes for use by transports.
 */
export type MutationMapFromDefinitions<D extends FateMutations> = {
  [K in keyof D]: {
    input: MutationInput<D[K]>;
    output: MutationResult<D[K]>;
  };
};

type Nullish<T> = Extract<T, null | undefined>;
type NonNullish<T> = Exclude<T, null | undefined>;

type OptimisticUpdateValue<T> =
  T extends ReadonlyArray<infer U>
    ? Array<OptimisticUpdateValue<U>>
    : NonNullish<T> extends AnyRecord
      ? OptimisticUpdate<NonNullish<T>> | Nullish<T>
      : NonNullish<T> | Nullish<T>;

/** Shape used to describe optimistic updates for mutations. */
export type OptimisticUpdate<T> = {
  [K in keyof T]?: OptimisticUpdateValue<T[K]>;
};

/** Snapshot captured before mutating the cache, used to roll back on errors. */
export type Snapshot = Readonly<{ mask?: FieldMask; record?: AnyRecord }>;

/** Promise-like value returned by cache reads that already have a resolved payload for React `use`. */
export interface FateThenable<T> extends PromiseLike<T> {
  status: 'fulfilled';
  value: T;
}
