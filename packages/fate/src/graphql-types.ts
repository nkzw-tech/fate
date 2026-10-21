import type { SelectedResult } from './selection-result.ts';
import type { SelectionOf, View } from './types.ts';

declare const GraphQLResultKind: unique symbol;
export declare const GraphQLSelectionBrand: unique symbol;

/** Marks a schema output whose result depends on the requested selection. */
export type GraphQLSelectedResult<T> = { readonly [GraphQLResultKind]: T };

export type SelectedGraphQLResult<T, S> = SelectedResult<T, S, false>;

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
