import type { AliasedSelection, AliasedView } from './alias.ts';
import type { SelectedGraphQLResult, GraphQLSelectedResult } from './graphql-types.ts';
import { FateMutations } from './mutation.ts';
import type { ConditionalSelection } from './when.ts';

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

/** Symbol used to mark a selection as deferred. */
export const DeferTag = Symbol('__fate__defer');

/** Symbol attached to deferred values returned from masked views. */
export const DeferredTag = Symbol('__fate__deferred');

export declare const __FateEntityBrand: unique symbol;
export declare const __FateSelectionBrand: unique symbol;
export declare const __FateMutationEntityBrand: unique symbol;
export declare const __FateMutationInputBrand: unique symbol;
export declare const __FateMutationResultBrand: unique symbol;
export declare const __FateRootResultBrand: unique symbol;
export declare const __FateRootTypeBrand: unique symbol;
export declare const __FateRootArgsBrand: unique symbol;
export declare const __FateDeferredBrand: unique symbol;

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
type __RootResultAnchor<R> = { readonly [__FateRootResultBrand]?: R };
type __RootTypeAnchor<T extends TypeName> = { readonly [__FateRootTypeBrand]?: T };

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

type Nullish<T> = Extract<T, null | undefined>;
type NonNullish<T> = Exclude<T, null | undefined>;
type WithNullish<T, R> = R | Nullish<T>;

type SelectionArgs = Readonly<{ args: AnyRecord }>;

export type ConnectionLivePolicy = Readonly<{
  append?: 'edge' | 'visible';
  prepend?: 'edge' | 'visible';
}>;

type ConnectionLiveSelectionPolicy = Readonly<{
  append?: ConnectionLivePolicy['append'] | string;
  prepend?: ConnectionLivePolicy['prepend'] | string;
}>;

/** Metadata stored alongside connection results to power pagination and cache updates. */
export type ConnectionMetadata = Readonly<{
  args?: AnyRecord;
  field: string;
  hash?: string;
  key: string;
  live?: ConnectionLivePolicy;
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
  | { possibleTypes?: ReadonlyArray<string>; type: string }
  /** Field contains an object without entity identity. */
  | { embedded: string }
  /** Field holds a list of entities of the given type. */
  | { array?: boolean; listOf: string; possibleTypes?: ReadonlyArray<string> };

/** Configuration for a server entity type used by the client cache. */
export type TypeConfig = {
  fields?: Record<string, RelationDescriptor>;
  getId: (record: unknown) => string | number;
  possibleTypes?: ReadonlyArray<string>;
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

/** Selection wrapper created by `defer(...)`. */
export type DeferredSelection<S> = Readonly<{
  [DeferTag]: S;
}>;

/** Runtime metadata used by the client to resolve a deferred field. */
export type DeferredMetadata = Readonly<{
  field: string;
  id: string | number;
  owner: EntityId;
  selection: unknown;
  type: string;
}>;

/** A deferred value returned from a masked view. Existing view hooks resolve it when read. */
export type Deferred<T> = Readonly<{
  [DeferredTag]: DeferredMetadata;
}> & { readonly [__FateDeferredBrand]: T };

/** Base shape shared by all entities fetched by fate. */
export type Entity = { __typename: string };

type PlainObjectSelectionField<V> =
  V extends Array<infer U>
    ? PlainObjectSelectionField<U> | true
    : V extends AnyRecord
      ? PlainObjectSelection<V> | true
      : true;

type PlainObjectSelection<T> = {
  [K in keyof T]?:
    | PlainObjectSelectionField<T[K]>
    | ConditionalSelection<boolean, PlainObjectSelectionField<T[K]>>;
} & { readonly [key: string]: unknown };

type ConnectionSelectionBase<T extends Entity> = Readonly<{
  items: Readonly<{
    cursor?: true;
    node: Selection<T> | View<T, Selection<T>>;
  }>;
  live?: ConnectionLiveSelectionPolicy;
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

type DeferrableSelectionFieldValue<T extends Entity, K extends keyof T> =
  | SelectionFieldValue<T, K>
  | DeferredSelection<SelectionFieldValue<T, K>>
  | ConditionalSelection<
      boolean,
      SelectionFieldValue<T, K> | DeferredSelection<SelectionFieldValue<T, K>>
    >;

type SelectionShape<T extends Entity> = {
  [K in keyof T as K extends '__typename' ? never : K]?: DeferrableSelectionFieldValue<T, K>;
} & { __typename?: true };

type SelectionViewSpread<T extends Entity> = {
  readonly [K in ViewTag]?: Readonly<{
    select: Selection<T>;
    [ViewKind]: true;
  }>;
};

/** Declarative selection of the fields a view needs from an entity. */
export type Selection<T extends Entity> = SelectionShape<T> &
  SelectionViewSpread<T> & { readonly [key: string]: unknown };

type SelectionMetadata =
  | ViewTag
  | 'args'
  | 'live'
  | typeof __FateEntityBrand
  | typeof __FateSelectionBrand;
type InvalidSelectedValue<T, S> = S extends true
  ? never
  : S extends DeferredSelection<infer Value>
    ? InvalidSelectedValue<T, Value>
    : S extends SelectionArgs
      ? Exclude<keyof S, 'args'> extends never
        ? never
        : InvalidSelectionObject<T, S>
      : InvalidSelectionObject<T, S>;
type InvalidSelectionObject<T, S> = S extends object
  ? NonNullable<T> extends Array<infer Item>
    ? S extends { items: { node: infer Node } }
      ? InvalidSelection<Item, Node>
      : InvalidSelection<Item, S>
    : NonNullable<T> extends object
      ? InvalidSelection<NonNullable<T>, S>
      : 'selection'
  : 'selection';
type InvalidSelectionEntry<T, K, S> =
  S extends ConditionalSelection<boolean, infer Value>
    ? InvalidSelectionEntry<T, K, Value>
    : S extends AliasedView<infer V>
      ? T extends ViewEntity<V>
        ? never
        : K
      : S extends AliasedSelection<infer Field, infer Value>
        ? Field extends keyof T
          ? InvalidSelectedValue<T[Field], Value>
          : K
        : K extends keyof T
          ? InvalidSelectedValue<T[K], S>
          : K;

type InvalidSelection<T, S> = 0 extends 1 & S
  ? never
  : { [K in Exclude<keyof S, SelectionMetadata>]-?: InvalidSelectionEntry<T, K, S[K]> }[Exclude<
      keyof S,
      SelectionMetadata
    >];

export type ValidateSelection<T extends Entity, S> =
  InvalidSelection<T, S> extends never ? unknown : never;

/** Extracts the selection type that was used to build a view. */
export type SelectionOf<V> = V extends {
  readonly [__FateSelectionBrand]?: infer S;
}
  ? S
  : never;

/** View payload stored on a view tag containing the raw selection used to mask data. */
export type ViewPayload<T extends Entity, S extends Selection<T> = Selection<T>> = Readonly<{
  definition?: string;
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

type ConnectionLikeSelection = {
  readonly items: { readonly node: unknown };
};

type ConnectionMask<T extends Entity, S> = S extends {
  readonly items: infer ItemSelection;
  readonly pagination?: infer PaginationSelection;
}
  ? {
      items: ItemSelection extends {
        readonly cursor?: infer CursorSelection;
        readonly node: unknown;
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
type ConditionalMask<C extends boolean, Value> = C extends true ? Value : undefined;
type MaskSelectionEntry<T, K, S> = [S] extends [never]
  ? NonNullish<T>[Extract<K, keyof T>]
  : S extends ConditionalSelection<infer C, infer Value>
    ? ConditionalMask<C, MaskSelectionEntry<T, K, Value>>
    : S extends AliasedView<infer V>
      ? ViewRef<ViewEntityName<V>>
      : S extends AliasedSelection<infer Field, infer Value>
        ? Mask<NonNullish<T>[Extract<Field, keyof T>], Value>
        : S extends true
          ? NonNullish<T>[Extract<K, keyof T>]
          : S extends DeferredSelection<infer Value>
            ? Deferred<Mask<NonNullish<T>[Extract<K, keyof T>], Value>>
            : Mask<NonNullish<T>[Extract<K, keyof T>], Extract<S, object>>;

type MaskNonNullish<T, S> =
  T extends Array<infer U extends Entity>
    ? S extends true
      ? Array<U>
      : S extends ConnectionLikeSelection
        ? ConnectionMask<U, S>
        : HasViewTag<S> extends true
          ? Array<ViewRef<U['__typename']>>
          : Array<Mask<U, S>>
    : S extends true
      ? T
      : S extends object
        ? HasViewTag<S> extends true
          ? NonNullish<T> extends Entity
            ? ViewRef<EntityName<NonNullish<T>>>
            : ViewRef<EntityName<NonNullable<T>>>
          : {
              [K in keyof S as K extends 'args' ? never : K]: MaskSelectionEntry<T, K, S[K]>;
            } & (T extends Entity ? Pick<NonNullish<T>, '__typename'> : Record<never, never>)
        : T;

export type Mask<T, S> = S extends SelectionArgs
  ? Exclude<keyof S, 'args'> extends never
    ? T
    : WithNullish<T, MaskNonNullish<NonNullish<T>, S>>
  : WithNullish<T, MaskNonNullish<NonNullish<T>, S>>;

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
  list: V;
}>;

/** Definition of a root-level query request. */
export type QueryItem<V extends View<any, any>> = Readonly<{
  args?: Record<string, unknown>;
  view: V;
}>;

export type ValueItem = Readonly<{
  args?: Record<string, unknown>;
  value: true | Record<string, unknown>;
}>;

/** Definition of a node request with one explicit ID for fetching data from the backend. */
export type NodeItem<V extends View<any, any>> = Readonly<{
  id: string | number;
  view: V;
}>;

/** Definition of a node request with explicit IDs for fetching data from the backend. */
export type NodesItem<V extends View<any, any>> = Readonly<{
  ids: ReadonlyArray<string | number>;
  view: V;
}>;

type RequestItem =
  | ListItem<View<any, any>>
  | NodeItem<View<any, any>>
  | NodesItem<View<any, any>>
  | QueryItem<View<any, any>>
  | ValueItem;

/** Collection of node and list requests describing the data a screen needs. */
export type Request = Record<string, RequestItem | AliasedSelection<string, RequestItem>>;

type AnyView = View<any, any>;
type AnyListItem = ListItem<AnyView>;
type AnyQueryItem = QueryItem<AnyView>;
type AnyNodeItem = NodeItem<AnyView>;
type AnyNodesItem = NodesItem<AnyView>;
type AnyRequestItem = AnyListItem | AnyNodeItem | AnyNodesItem | AnyQueryItem | ValueItem;
type AnyRequest = Record<string, AnyRequestItem | AliasedSelection<string, AnyRequestItem>>;

/**
 * Typed result returned by `useRequest` and `FateClient.request`, mapping each
 * request key to an array of view refs for the requested type.
 */
type ConnectionNodeType<Root> = Root extends { items?: { node?: infer Node } }
  ? ViewEntityName<Node & View<any, any>>
  : never;

type NullableRootResult<Result> = unknown extends Result
  ? never
  : null extends Result
    ? null
    : never;

type ListResult<Item extends AnyRequestItem, Type extends TypeName, Result> = Item extends ValueItem
  ? Result extends GraphQLSelectedResult<infer Output>
    ? SelectedGraphQLResult<Output, Item['value']>
    : Result
  : Item extends AnyNodeItem
    ? ViewRef<Type>
    : Item extends AnyNodesItem
      ? Array<ViewRef<Type>>
      : Item extends AnyQueryItem
        ? Result extends null
          ? ViewRef<Type> | null
          : ViewRef<Type>
        : Item extends AnyListItem
          ?
              | (Item['list'] extends { items?: { node?: View<any, any> } }
                  ? Readonly<{
                      items: ReadonlyArray<{
                        cursor?: string | undefined;
                        node: ViewRef<ConnectionNodeType<Item['list']>>;
                      }>;
                      pagination?: Pagination;
                    }>
                  : Array<ViewRef<Type>>)
              | NullableRootResult<Result>
          : never;

/**
 * The result of a `FateClient.request` and `useRequest` call, mapping each
 * request key to its corresponding result.
 */
export type RequestResult<R extends FateRoots, Q extends AnyRequest> = {
  [K in keyof Q]: Q[K] extends AliasedSelection<infer Field, infer Item extends AnyRequestItem>
    ? Field extends keyof R
      ? ListResult<Item, RootType<R[Field]>, RootResult<R[Field]>>
      : never
    : K extends keyof R
      ? ListResult<Extract<Q[K], AnyRequestItem>, RootType<R[K]>, RootResult<R[K]>>
      : never;
};

/** Applies generated argument contracts while preserving inference of request results. */
type CheckRequestItem<Roots extends FateRoots, K, Item> = Item extends AnyNodeItem | AnyNodesItem
  ? unknown
  : K extends keyof Roots
    ? Roots[K] extends { readonly [__FateRootArgsBrand]?: infer Args }
      ? string extends keyof Args
        ? unknown
        : (Record<never, never> extends Args ? { args?: Args } : { args: Args }) &
            (Item extends { args: infer Actual }
              ? { args: { [Extra in Exclude<keyof Actual, keyof Args>]: never } }
              : unknown)
      : unknown
    : unknown;

export type CheckedRequest<Roots extends FateRoots, R extends Request> = R & {
  [K in keyof R]: R[K] extends AliasedSelection<infer Field, infer Item>
    ? { selection: CheckRequestItem<Roots, Field, Item> }
    : CheckRequestItem<Roots, K, R[K]>;
};

/** Indicates whether a request item represents an explicit node ID. */
export function isNodeItem(item: AnyRequestItem): item is AnyNodeItem {
  return 'id' in item;
}
/** Indicates whether a request item represents explicit node IDs. */
export function isNodesItem(item: AnyRequestItem): item is AnyNodesItem {
  return 'ids' in item;
}

/** Indicates whether a request item represents a root query. */
export function isQueryItem(item: AnyRequestItem): item is AnyQueryItem {
  return 'view' in item && !('id' in item) && !('ids' in item);
}

export function isValueItem(item: AnyRequestItem): item is ValueItem {
  return 'value' in item;
}

/** Brand used on root definitions to mark their identity in the d.ts output. */
export const RootKind = '__fate__root';

/** Brand used on mutation definitions to mark their identity in the d.ts output. */
export const MutationKind = '__fate__mutation';

/** Metadata describing a root query for a particular entity and result shape. */
export type RootDefinition<Type extends TypeName, Result, Args = AnyRecord> = Readonly<{
  readonly [__FateRootArgsBrand]?: Args;
  [RootKind]: true;
  type: Type;
}> &
  __RootResultAnchor<Result> &
  __RootTypeAnchor<Type>;

/** Minimal root description used for typing root maps. */
export type FateRoots = Record<string, RootDefinition<TypeName, unknown>>;

/** Extracts the entity type name from a root definition. */
export type RootType<R> = R extends __RootTypeAnchor<infer T> ? T : never;

/** Extracts the result type from a root definition. */
export type RootResult<R> = R extends __RootResultAnchor<infer Data> ? Data : never;

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

/** Promise-like value returned by cache reads that already have a resolved payload for React `use`. */
export interface FateThenable<T> extends PromiseLike<T> {
  status: 'fulfilled';
  value: T;
}
