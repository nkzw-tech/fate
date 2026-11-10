import { expect, expectTypeOf, test } from 'vite-plus/test';
import { computed, memo } from '../index.ts';
import {
  computed as serverComputed,
  memo as serverMemo,
  type ComputedField,
  type ComputedSelection,
  type MemoField,
  type MemoSelection,
} from '../server.ts';

test('memo preserves the legacy helper and field types across client and server exports', () => {
  expect(computed).toBe(memo);
  expect(serverMemo).toBe(memo);
  expect(serverComputed).toBe(memo);
  expectTypeOf(computed).toEqualTypeOf(memo);
  expectTypeOf<ComputedField<{ value: number }, number, unknown>>().toEqualTypeOf<
    MemoField<{ value: number }, number, unknown>
  >();
  expectTypeOf<ComputedSelection>().toEqualTypeOf<MemoSelection>();

  const field = serverMemo({
    resolve: (_item: { value: number }, { value }): number => {
      expectTypeOf(value).toEqualTypeOf<number>();
      return value * 2;
    },
    select: { value: true },
  });
  expect(field.resolve({ value: 3 }, { value: 3 })).toBe(6);
  expectTypeOf(field.resolve).returns.toEqualTypeOf<number | Promise<number>>();
});
