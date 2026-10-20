import type { AliasedSelection, AliasedView } from './alias.ts';
import type { DeferredSelection, SelectionOf, View, ViewTag } from './types.ts';
import type { ConditionalSelection } from './when.ts';

declare const GraphQLResultKind: unique symbol;
export declare const GraphQLSelectionBrand: unique symbol;

/** Marks a schema output whose result depends on the requested selection. */
export type GraphQLSelectedResult<T> = { readonly [GraphQLResultKind]: T };

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
type Identity<T> = T extends { __typename: string; id: unknown }
  ? Pick<T, 'id' | '__typename'>
  : Record<never, never>;
type SelectedField<T, S> =
  S extends ConditionalSelection<infer Condition, infer Value>
    ? Condition extends true
      ? SelectedField<T, Value>
      : undefined
    : S extends true
      ? T extends { __typename: string }
        ? Identity<T>
        : T
      : SelectedGraphQLResult<T, S>;

/** The unmasked transport result; unlike ViewData, it has no view tags or refs. */
export type SelectedGraphQLResult<T, S> = T extends null | undefined
  ? T
  : T extends Array<infer Item>
    ? Array<SelectedGraphQLResult<Item, S>>
    : T extends { items: Array<infer Edge>; pagination: infer Pagination }
      ? {
          items: Array<
            Edge extends { cursor: infer Cursor; node: infer Node }
              ? {
                  cursor: Cursor;
                  node: SelectedGraphQLResult<
                    Node,
                    S extends { items: { node: infer Fields } } ? Fields : S
                  >;
                }
              : never
          >;
          pagination: Pagination;
        }
      : T extends { __typename: string }
        ? Identity<T> & {
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
              ? SelectedField<T[Extract<Field, keyof T>], Fields>
              : SelectedField<T[Extract<K, keyof T>], ExpandedSelection<S>[K]>;
          }
        : T;

export type GraphQLMutationCallResult<Identifier, Options, Fallback> = Identifier extends {
  readonly [GraphQLSelectionBrand]: infer Result;
}
  ? SelectedGraphQLResult<
      Result,
      Options extends { view: infer V extends View<any, any> }
        ? SelectionOf<V>
        : Options extends { select: infer S extends object }
          ? S
          : Record<never, never>
    >
  : Fallback;
