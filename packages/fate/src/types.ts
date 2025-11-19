import { FieldMask } from './mask.ts';

export type TypeName = string;
export type EntityId = string;

export const ViewKind = Symbol('__fate__view');
export const ViewsTag = Symbol('__fate__views');
export const NodeRefTag = Symbol('__fate__node-ref');
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
  readonly [__FateSelectionBrand]?: S;
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

export type ViewTag = `__fate-view__${number}`;

const viewTag = '__fate-view__' as const;

export function getViewTag(id: number): ViewTag {
  return `${viewTag}${id}`;
}

export function isViewTag(key: string): key is ViewTag {
  return key.startsWith(viewTag);
}

export type AnyRecord = Record<string, unknown>;

type SelectionArgs = Readonly<{ args: AnyRecord }>;

export type ConnectionMetadata = Readonly<{
  args?: AnyRecord;
  field: string;
  hash?: string;
  key: string;
  owner: EntityId;
  procedure: string;
}>;

export type ViewResult = AnyRecord & {
  readonly [ViewsTag]?: Set<string>;
};

export type ViewRef<TName extends string> = Readonly<{
  __typename: TName;
  id: string | number;
  [ViewsTag]: Set<string>;
}>;

export type RelationDescriptor =
  | 'scalar'
  | { type: string }
  | { listOf: string };

export type TypeConfig = {
  fields?: Record<string, RelationDescriptor>;
  getId: (record: unknown) => string | number;
  type: string;
};

export type Pagination = {
  hasNext: boolean;
  hasPrevious: boolean;
  nextCursor?: string;
  previousCursor?: string;
};

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

type ConnectionSelectionBase<T extends Entity> = {
  readonly items: {
    readonly cursor?: true;
    readonly node: Selection<T> | View<T, Selection<T>>;
  };
  readonly pagination?: {
    readonly hasNext?: true;
    readonly hasPrevious?: true;
    readonly nextCursor?: true;
    readonly previousCursor?: true;
  };
};

export type ConnectionSelection<T extends Entity> =
  | ConnectionSelectionBase<T>
  | (SelectionArgs & ConnectionSelectionBase<T>);

type BaseSelectionFieldValue<T extends Entity, K extends keyof T> =
  NonNullable<T[K]> extends Array<infer U extends Entity>
    ? true | Selection<U> | ConnectionSelection<U> | View<U, Selection<U>>
    : NonNullable<T[K]> extends Entity
      ?
          | true
          | Selection<NonNullable<T[K]>>
          | View<NonNullable<T[K]>, Selection<NonNullable<T[K]>>>
      : NonNullable<T[K]> extends AnyRecord
        ? PlainObjectSelection<NonNullable<T[K]>>
        : true;

type SelectionFieldValue<T extends Entity, K extends keyof T> =
  | BaseSelectionFieldValue<T, K>
  | SelectionArgs
  | (SelectionArgs & Extract<BaseSelectionFieldValue<T, K>, object>);

type SelectionShape<T extends Entity> = {
  [K in keyof T as K extends '__typename' ? never : K]?: SelectionFieldValue<
    T,
    K
  >;
} & { __typename?: true };

type SelectionViewSpread<T extends Entity> = {
  readonly [K in ViewTag]?: Readonly<{
    select: Selection<T>;
    [ViewKind]: true;
  }>;
};

export type Selection<T extends Entity> = SelectionShape<T> &
  SelectionViewSpread<T>;

export type SelectionOf<V> = V extends {
  readonly [__FateSelectionBrand]?: infer S;
}
  ? S
  : never;

export type ViewPayload<
  T extends Entity,
  S extends Selection<T> = Selection<T>,
> = Readonly<{
  select: S;
  [ViewKind]: true;
}>;

export type View<
  T extends Entity,
  S extends Selection<T> = Selection<T>,
> = Readonly<{
  [viewTag: ViewTag]: ViewPayload<T, S>;
}> &
  __ViewEntityAnchor<T> &
  __ViewSelectionAnchor<S>;

type HasViewTag<S> = S extends { [K in ViewTag]?: infer P }
  ? P extends { [ViewKind]: true }
    ? true
    : false
  : false;

export type ViewData<T extends Entity, S extends Selection<T>> = Readonly<
  (S extends Selection<T> ? Mask<T, S> : T) & {
    [ViewsTag]: Set<string>;
  }
>;

export type ViewSnapshot<T extends Entity, S extends Selection<T>> = Readonly<{
  data: ViewData<T, S>;
  ids: ReadonlySet<EntityId>;
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
            (CursorSelection extends true
              ? { cursor: string }
              : Record<string, never>) & {
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

type EntityName<T> = T extends { __typename: infer N extends string }
  ? N
  : never;

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
                : Mask<
                    NonNullable<T>[Extract<K, keyof T>],
                    Extract<S[K], object>
                  >;
            }
        : T;

type ViewEntity<V> = V extends View<infer T, any> ? T : never;
type ViewEntityName<V> = ViewEntity<V>['__typename'] & string;

export type ListItem<V extends View<any, any>> = Readonly<{
  args?: Record<string, unknown>;
  root: V;
  type: ViewEntityName<V>;
}>;

export type NodeItem<V extends View<any, any>> = Readonly<{
  ids: ReadonlyArray<string | number>;
  root: V;
  type: ViewEntityName<V>;
}>;

type RequestItem = ListItem<View<any, any>> | NodeItem<View<any, any>>;
export type Request = Record<string, RequestItem>;

type AnyView = View<any, any>;
type AnyListItem = ListItem<AnyView>;
type AnyNodeItem = NodeItem<AnyView>;
type AnyRequestItem = AnyListItem | AnyNodeItem;
type AnyRequest = Record<string, AnyRequestItem>;

export type RequestResult<Q extends AnyRequest> = {
  [K in keyof Q]: Q[K] extends { type: infer NodeType extends string }
    ? Array<ViewRef<NodeType>>
    : never;
};

export function isNodeItem(item: AnyRequestItem): item is AnyNodeItem {
  return 'ids' in item;
}

export const MutationKind = '__fate__$mutation';

export type MutationDefinition<T extends Entity, I, R> = Readonly<{
  entity: T['__typename'];
  [MutationKind]: true;
}> &
  __MutationEntityAnchor<T> &
  __MutationInputAnchor<I> &
  __MutationResultAnchor<R>;

export type MutationIdentifier<T extends Entity, I, R> = MutationDefinition<
  T,
  I,
  R
> &
  Readonly<{ key: string }>;

export type MutationInput<M> =
  M extends __MutationInputAnchor<infer I> ? I : never;
export type MutationResult<M> =
  M extends __MutationResultAnchor<infer R> ? R : never;
export type MutationEntity<M> =
  M extends __MutationEntityAnchor<infer E> ? E : never;

export type MutationShape = { input: unknown; output: unknown };

export type MutationMapFromDefinitions<
  D extends Record<string, MutationDefinition<any, any, any>>,
> = {
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

export type OptimisticUpdate<T> = {
  [K in keyof T]?: OptimisticUpdateValue<T[K]>;
};

export type Snapshot = Readonly<{ mask?: FieldMask; record?: AnyRecord }>;

export interface FateThenable<T> extends PromiseLike<T> {
  status: 'fulfilled';
  value: T;
}
