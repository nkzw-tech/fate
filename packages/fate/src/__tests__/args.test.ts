import { describe, expect, test } from 'vitest';
import { cloneArgs, hashArgs } from '../args.ts';
import type { AnyRecord } from '../types.ts';

describe('cloneArgs', () => {
  test('clones nested arrays and objects', () => {
    const source = {
      filter: {
        range: { end: 100, start: 1 },
        tags: [{ label: 'important', value: 't-1' }],
      },
      limit: 10,
    };

    const cloned = cloneArgs(source, '__root');

    expect(cloned).toEqual(source);
    expect(cloned).not.toBe(source);
    const clonedFilter = cloned.filter as AnyRecord;
    const clonedTags = clonedFilter.tags as Array<AnyRecord>;

    expect(clonedFilter).not.toBe(source.filter);
    expect(clonedFilter.range).not.toBe(source.filter.range);
    expect(clonedTags).not.toBe(source.filter.tags);
    expect(clonedTags[0]).not.toBe(source.filter.tags[0]);
  });

  test('throws when encountering non-serializable values', () => {
    expect(() =>
      cloneArgs(
        {
          handler: () => undefined,
        },
        '__root',
      ),
    ).toThrow(/must be serializable/);
  });
});

describe('hashArgs', () => {
  test('produces stable hashes and supports ignoring keys', () => {
    const args = { after: 'cursor-1', first: 2, id: 'post-1' };
    const sameArgs = { after: 'cursor-1', first: 2, id: 'post-1' };

    expect(hashArgs(args)).toEqual(hashArgs(sameArgs));

    const ignored = hashArgs(args, { ignoreKeys: new Set(['after']) });
    expect(ignored).not.toEqual(hashArgs(args));
  });
});
