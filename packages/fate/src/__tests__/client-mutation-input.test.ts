import { expect, expectTypeOf, test } from 'vite-plus/test';
import { z } from 'zod';
import {
  clientSchema,
  createClient,
  dataView,
  type ClientDefinitionOf,
  type MutationInput,
} from '../index.ts';

const schema = clientSchema({
  roots: { counter: { id: 'main', type: 'Counter' } },
  types: {
    Counter: {
      defaults: (id) => ({ id, value: 0 }),
      view: dataView<{ id: string; value: number }>('Counter')({ id: true, value: true }),
    },
  },
});

test('mutation callers use schema input while resolvers use defaults and transformed output', async () => {
  const inputSchema = z.object({
    amount: z.number().default(1),
    text: z.string().transform((text) => text.length),
  });
  const client = createClient().registerClientSchema(schema, ({ mutation }) => ({
    set: mutation('Counter', {
      input: inputSchema,
      resolve: ({ input, store }) => {
        expectTypeOf(input).toEqualTypeOf<z.output<typeof inputSchema>>();
        store.update('Counter', 'main', { value: input.amount + input.text });
        return input;
      },
    }),
  }));
  type Input = MutationInput<ClientDefinitionOf<typeof client>['mutations']['set']>;
  expectTypeOf<Input>().toEqualTypeOf<z.input<typeof inputSchema>>();
  expect((await client.mutations.set({ input: { text: 'four' } })).result).toEqual({
    amount: 1,
    text: 4,
  });
  expect((await client.mutations.set({ input: { amount: 3, text: 'two' } })).result).toEqual({
    amount: 3,
    text: 3,
  });
  expect((await client.actions.set(null, { input: { text: 'hi' } })).result).toEqual({
    amount: 1,
    text: 2,
  });
  // @ts-expect-error Callers supply the pre-transform string, not the parsed number.
  await expect(client.mutations.set({ input: { text: 4 } })).rejects.toThrow();
});

test('default-only schemas accept an empty input object', async () => {
  const client = createClient().registerClientSchema(schema, ({ mutation }) => ({
    increment: mutation('Counter', {
      input: z.object({ amount: z.number().default(1) }),
      resolve: ({ input }) => {
        expectTypeOf(input.amount).toEqualTypeOf<number>();
        return input.amount;
      },
    }),
  }));
  expect((await client.mutations.increment({ input: {} })).result).toBe(1);
});

test('custom parse-only inputs keep their inferred caller and resolver types', async () => {
  const client = createClient().registerClientSchema(schema, ({ mutation }) => ({
    increment: mutation('Counter', {
      input: {
        parse: (value: unknown): { amount: number } => {
          if (!value || typeof value !== 'object' || !('amount' in value)) {
            throw new Error('Missing amount');
          }
          return { amount: Number(value.amount) };
        },
      },
      resolve: ({ input }) => {
        expectTypeOf(input).toEqualTypeOf<{ amount: number }>();
        return input.amount;
      },
    }),
  }));
  type Input = MutationInput<ClientDefinitionOf<typeof client>['mutations']['increment']>;
  expectTypeOf<Input>().toEqualTypeOf<{ amount: number }>();
  expect((await client.mutations.increment({ input: { amount: 3 } })).result).toBe(3);
  // @ts-expect-error Parse-only schemas cannot infer a separate optional caller input.
  await expect(client.mutations.increment({ input: {} })).rejects.toThrow('Missing amount');
});
