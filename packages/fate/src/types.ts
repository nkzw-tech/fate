import { FieldMask } from './mask.ts';

export type TypeName = string;
export type EntityId = string;

export const FragmentKind = '__fate__$fragment';
export const FragmentsTag = Symbol('__fate__$fragments');

export declare const __FateEntityBrand: unique symbol;
export declare const __FateSelectionBrand: unique symbol;
export declare const __FateMutationEntityBrand: unique symbol;
export declare const __FateMutationInputBrand: unique symbol;
export declare const __FateMutationResultBrand: unique symbol;

type __FragmentEntityAnchor<T extends Entity> = {
  readonly [__FateEntityBrand]?: T;
};
type __FragmentSelectionAnchor<S> = {
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

export type FragmentTag = `__fate$fragment__$${number}`;

const fragmentTag = '__fate$fragment__$' as const;

export function getFragmentTag(id: number): FragmentTag {
  return `${fragmentTag}${id}`;
}

export function isFragmentTag(key: string): key is FragmentTag {
  return key.startsWith(fragmentTag);
}

export type FateRecord = Record<string, unknown>;
export type FragmentResult = FateRecord & {
  readonly [FragmentsTag]?: Set<string>;
};

export type FragmentRef<TName extends string> = Readonly<{
  __typename: TName;
  [FragmentsTag]: Set<string>;
  id: string | number;
}>;

export type RelationDescriptor =
  | 'scalar'
  | { type: string }
  | { listOf: string };

export type EntityConfig = {
  fields?: Record<string, RelationDescriptor>;
  key: (record: unknown) => string | number;
  type: string;
};

export type PageInfo = { endCursor?: string; hasNextPage: boolean };

export type Entity = { __typename: string };

export type ConnectionSelection<T extends Entity> = {
  readonly edges: {
    readonly cursor?: true;
    readonly node: Selection<T> | Fragment<T, Selection<T>>;
  };
  readonly pageInfo?: {
    readonly endCursor?: true;
    readonly hasNextPage?: true;
  };
};

export type Selection<T extends Entity> = {
  [K in keyof T]?: T[K] extends Array<infer U extends Entity>
    ? true | Selection<U> | ConnectionSelection<U> | Fragment<U, Selection<U>>
    : T[K] extends Entity | null
      ?
          | true
          | Selection<NonNullable<T[K]>>
          | Fragment<NonNullable<T[K]>, Selection<NonNullable<T[K]>>>
      : true;
};

export type SelectionOf<F> = F extends {
  readonly [__FateSelectionBrand]?: infer S;
}
  ? S
  : never;

export type FragmentPayload<
  T extends Entity,
  S extends Selection<T> = Selection<T>,
> = Readonly<{
  [FragmentKind]: true;
  select: S;
}>;

export type Fragment<
  T extends Entity,
  S extends Selection<T> = Selection<T>,
> = Readonly<{
  [fragmentTag: FragmentTag]: FragmentPayload<T, S>;
}> &
  __FragmentEntityAnchor<T> &
  __FragmentSelectionAnchor<S>;

type HasFragmentTag<S> = S extends { [K in FragmentTag]?: infer P }
  ? P extends { [FragmentKind]: true }
    ? true
    : false
  : false;

export type FragmentData<
  T extends Entity,
  S extends Selection<T>,
> = (S extends Selection<T> ? Mask<T, S> : T) & {
  readonly [FragmentsTag]: Set<string>;
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
              node: FragmentRef<T['__typename']>;
            }
          >
        : Array<{ node: FragmentRef<T['__typename']> }>;
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
        : HasFragmentTag<S> extends true
          ? Array<FragmentRef<U['__typename']>>
          : Array<Mask<U, S>>
    : S extends true
      ? T
      : S extends object
        ? HasFragmentTag<S> extends true
          ? FragmentRef<EntityName<NonNullable<T>>>
          : {
              [K in keyof S]: S[K] extends true
                ? NonNullable<T>[Extract<K, keyof T>]
                : Mask<
                    NonNullable<T>[Extract<K, keyof T>],
                    Extract<S[K], object>
                  >;
            }
        : T;

type FragmentEntity<F> = F extends Fragment<infer T, any> ? T : never;
type FragmentEntityName<F> = FragmentEntity<F>['__typename'] & string;

export type ListItem<F extends Fragment<any, any>> = Readonly<{
  args: unknown;
  root: F; // carries T, S
  type: FragmentEntityName<F>; // must match the fragment's entity name
}>;

export type NodeItem<F extends Fragment<any, any>> = Readonly<{
  ids: ReadonlyArray<string | number>;
  root: F;
  type: FragmentEntityName<F>;
}>;

type QueryItem = ListItem<Fragment<any, any>> | NodeItem<Fragment<any, any>>;
export type Query = Record<string, QueryItem>;

export type AnyFragment = Fragment<any, any>;
export type AnyListItem = ListItem<AnyFragment>;
export type AnyNodeItem = NodeItem<AnyFragment>;
export type AnyQueryItem = AnyListItem | AnyNodeItem;
export type AnyQuery = Record<string, AnyQueryItem>;

export type QueryResult<Q extends AnyQuery> = {
  [K in keyof Q]: Q[K] extends { type: infer NodeType extends string }
    ? Array<FragmentRef<NodeType>>
    : never;
};

export function isNodeItem(item: AnyQueryItem): item is AnyNodeItem {
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
export type MutationEntityName<M> = MutationEntity<M>['__typename'] & string;

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
