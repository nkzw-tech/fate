import { FieldMask } from './mask.ts';

export type TypeName = string;
export type EntityId = string;

export const ViewKind = '__fate__view';
export const ViewsTag = Symbol('__fate__views');

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

export type FateRecord = Record<string, unknown>;
export type ViewResult = FateRecord & {
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

export type PageInfo = { endCursor?: string; hasNextPage: boolean };

export type Entity = { __typename: string };

export type ConnectionSelection<T extends Entity> = {
  readonly edges: {
    readonly cursor?: true;
    readonly node: Selection<T> | View<T, Selection<T>>;
  };
  readonly pageInfo?: {
    readonly endCursor?: true;
    readonly hasNextPage?: true;
  };
};

type SelectionFieldValue<T extends Entity, K extends keyof T> =
  T[K] extends Array<infer U extends Entity>
    ? true | Selection<U> | ConnectionSelection<U> | View<U, Selection<U>>
    : T[K] extends Entity | null
      ?
          | true
          | Selection<NonNullable<T[K]>>
          | View<NonNullable<T[K]>, Selection<NonNullable<T[K]>>>
      : true;

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

export type ViewData<
  T extends Entity,
  S extends Selection<T>,
> = (S extends Selection<T> ? Mask<T, S> : T) & {
  readonly [ViewsTag]: Set<string>;
};

type ConnectionMask<T extends Entity, S> = S extends {
  edges: infer EdgeSelection;
  pageInfo?: infer PageInfoSelection;
}
  ? {
      edges: EdgeSelection extends {
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
    } & (PageInfoSelection extends object
      ? {
          pageInfo: {
            [K in keyof PageInfoSelection]: PageInfo[K & keyof PageInfo];
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
              [K in keyof S]: S[K] extends true
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
  args: unknown;
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

export type Snapshot = Readonly<{ mask?: FieldMask; record?: FateRecord }>;

export interface FateThenable<T> extends PromiseLike<T> {
  status: 'fulfilled';
  value: T;
}
