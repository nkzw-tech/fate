import { expect, test } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { withNormalizationInput, type NormalizationInput } from '../normalization-input.ts';
import type { AnyRecord } from '../types.ts';

const materialize = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(materialize)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value).map((key) => [
            key,
            key === 'id'
              ? String((value as AnyRecord)[key]).replace('wire:', '')
              : materialize((value as AnyRecord)[key]),
          ]),
        )
      : value;

const input: NormalizationInput = {
  child: () => input,
  connection: (value) => value,
  get: (record, key) => (key === 'id' ? String(record[key]).replace('wire:', '') : record[key]),
  has: (record, key) => Object.hasOwn(record, key),
  keys: Object.keys,
  materialize,
};

test.each([false, true])(
  'shares normalization semantics with an input reader (custom identity: %s)',
  (custom) => {
    const types = [
      {
        fields: {
          child: { type: 'User' },
          friends: { listOf: 'User' },
          profile: { embedded: 'Profile' },
          tags: 'scalar' as const,
        },
        ...(custom
          ? {
              getId: (record: unknown) =>
                `${(record as AnyRecord).id}:${(record as AnyRecord).name}`,
            }
          : {}),
        type: 'User',
      },
    ];
    const create = () =>
      createClient({ roots: {}, transport: { fetchById: async () => [] }, types });
    const expected = create();
    const actual = create();
    const select = new Set([
      'id',
      'name',
      'child.id',
      'child.name',
      'friends.id',
      'friends.name',
      'profile.label',
      'profile.rows.label',
      'tags',
    ]);
    const record = {
      child: { id: 'wire:2', name: 'Lin' },
      friends: {
        items: [{ cursor: 'one', node: { id: 'wire:2', name: 'Lin' } }],
        pagination: { hasNext: false },
      },
      id: 'wire:1',
      name: 'Ada',
      profile: { label: 'one', rows: [{ label: 'row', stale: true }] },
      tags: ['one'],
    };
    for (const value of [
      record,
      { ...record, profile: { rows: [{ label: 'changed' }] }, tags: ['two'] },
    ]) {
      expected.write('User', materialize(value) as AnyRecord, select);
      actual.write('User', withNormalizationInput(value, input), select);
    }
    expect(actual.store.dehydrate()).toEqual(expected.store.dehydrate());
    record.tags.push('later');
    expect(actual.store.dehydrate()).toEqual(expected.store.dehydrate());
  },
);
