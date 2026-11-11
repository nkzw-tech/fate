import type {
  ClientMutationBuilder as CoreBuilder,
  ClientMutationContext as CoreContext,
  ClientStore as CoreStore,
  ClientOf as CoreClientOf,
} from '@nkzw/fate';
import { expectTypeOf, test } from 'vite-plus/test';
import type {
  ClientMutationBuilder,
  ClientMutationContext,
  ClientStore,
  ClientOf,
} from '../index.ts';

type Empty = Record<never, never>;
type Schema = { types: Empty };

test('re-exports the public client mutation types', () => {
  expectTypeOf<ClientOf<Schema>>().toEqualTypeOf<CoreClientOf<Schema>>();
  expectTypeOf<ClientStore<Empty, Schema>>().toEqualTypeOf<CoreStore<Empty, Schema>>();
  expectTypeOf<ClientMutationBuilder<Empty, Empty, Schema>>().toEqualTypeOf<
    CoreBuilder<Empty, Empty, Schema>
  >();
  expectTypeOf<ClientMutationContext<Empty, Empty, Empty, Schema>>().toEqualTypeOf<
    CoreContext<Empty, Empty, Empty, Schema>
  >();
});
