import type { AliasedSelection, AliasedView } from './alias.ts';
import type { DeferredSelection, ViewTag } from './types.ts';
import type { ConditionalSelection } from './when.ts';

type Intersect<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;

type SpreadSelection<S> = Intersect<
  {
    [K in keyof S]: K extends ViewTag
      ? S[K] extends { select: infer Fields }
        ? Fields
        : never
      : never;
  }[keyof S]
>;
type ExpandedSelection<S> = S & SpreadSelection<S>;
type Identity<T> = T extends { id: unknown }
  ? Pick<T, Extract<keyof T, 'id' | '__typename'>>
  : Record<never, never>;
type SelectedField<T, S, SelectObjects extends boolean> =
  S extends ConditionalSelection<infer Condition, infer Value>
    ? Condition extends true
      ? SelectedField<T, Value, SelectObjects>
      : undefined
    : S extends true
      ? T extends { __typename: string }
        ? Identity<T>
        : SelectObjects extends true
          ? T extends { id: unknown }
            ? Identity<T>
            : T
          : T
      : SelectedResult<T, S, SelectObjects>;

type SelectedObject<T, S, SelectObjects extends boolean> = Identity<T> & {
  [
    K in keyof ExpandedSelection<S> as K extends ViewTag | 'args' | 'live'
      ? never
      : ExpandedSelection<S>[K] extends false | DeferredSelection<unknown> | AliasedView
        ? never
        : ExpandedSelection<S>[K] extends AliasedSelection<infer Field, unknown>
          ? K extends string
            ? `${K}:${Field}`
            : never
          : K extends keyof T
            ? K
            : never
  ]: ExpandedSelection<S>[K] extends AliasedSelection<infer Field, infer Fields>
    ? SelectedField<T[Extract<Field, keyof T>], Fields, SelectObjects>
    : SelectedField<T[Extract<K, keyof T>], ExpandedSelection<S>[K], SelectObjects>;
};

/** The unmasked transport result; unlike ViewData, it has no view tags or refs. */
export type SelectedResult<T, S, SelectObjects extends boolean = true> = T extends null | undefined
  ? T
  : T extends ReadonlyArray<infer Item>
    ? T extends Array<Item>
      ? Array<SelectedResult<Item, S, SelectObjects>>
      : SelectObjects extends true
        ? ReadonlyArray<SelectedResult<Item, S, SelectObjects>>
        : T
    : T extends { items: Array<infer Edge>; pagination: infer Pagination }
      ? {
          items: Array<
            Edge extends { cursor: infer Cursor; node: infer Node }
              ? {
                  cursor: Cursor;
                  node: SelectedResult<
                    Node,
                    S extends { items: { node: infer Fields } } ? Fields : S,
                    SelectObjects
                  >;
                }
              : never
          >;
          pagination: Pagination;
        }
      : T extends { __typename: string }
        ? SelectedObject<T, S, SelectObjects>
        : SelectObjects extends true
          ? T extends object
            ? SelectedObject<T, S, SelectObjects>
            : T
          : T;

type MergeSelectedFields<A, B> = {
  [K in keyof A | keyof B]: K extends keyof A
    ? K extends keyof B
      ? MergeSelectedResults<A[K], B[K]>
      : A[K]
    : K extends keyof B
      ? B[K]
      : never;
};

type MergeSelectedData<A, B> = [A] extends [never]
  ? B
  : [B] extends [never]
    ? A
    : A extends ReadonlyArray<infer ItemA>
      ? B extends ReadonlyArray<infer ItemB>
        ? A extends Array<ItemA>
          ? B extends Array<ItemB>
            ? Array<MergeSelectedResults<ItemA, ItemB>>
            : ReadonlyArray<MergeSelectedResults<ItemA, ItemB>>
          : ReadonlyArray<MergeSelectedResults<ItemA, ItemB>>
        : never
      : A extends object
        ? B extends object
          ? A extends { __typename: infer NameA }
            ? B extends { __typename: infer NameB }
              ? [NameA & NameB] extends [never]
                ? never
                : MergeSelectedFields<A, B>
              : MergeSelectedFields<A, B>
            : MergeSelectedFields<A, B>
          : never
        : A & B;

/** Combine additive selections without letting a conditional field erase an existing field. */
export type MergeSelectedResults<A, B> = unknown extends A
  ? A
  : unknown extends B
    ? B
    :
        | Extract<A | B, null>
        | (undefined extends A ? (undefined extends B ? undefined : never) : never)
        | MergeSelectedData<NonNullable<A>, NonNullable<B>>;
