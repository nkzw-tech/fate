import { describe, expect, test } from 'vite-plus/test';
import {
  cloneArgs,
  combineArgsPayload,
  getArgsAtPath,
  hashArgs,
  resolvedArgsFromPlan,
  scopeArgsPayload,
} from '../args.ts';
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

  test('includes prototype-named own arguments in cache keys', () => {
    const args = JSON.parse('{"__proto__":{"flag":true},"constructor":"value","toString":1}');
    expect(hashArgs(args)).not.toBe(hashArgs({ constructor: 'value', toString: 1 }));
    expect(hashArgs(cloneArgs(args, 'args'))).toBe(hashArgs(args));
  });
});

test('argument merges preserve prototype-named data without modifying prototypes', () => {
  const source = JSON.parse(
    '{"__proto__":{"fateArgumentPollution":true},"constructor":{"prototype":{"value":1}},"toString":2}',
  );
  try {
    const result = combineArgsPayload(undefined, source)!;
    expect(Object.hasOwn(Object.prototype, 'fateArgumentPollution')).toBe(false);
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.getPrototypeOf(result.__proto__)).toBeNull();
    expect(JSON.stringify(result)).toBe(JSON.stringify(source));
    expect(getArgsAtPath({}, '__proto__')).toBeUndefined();
    expect(getArgsAtPath(result, '__proto__')).toEqual({ fateArgumentPollution: true });
  } finally {
    delete (Object.prototype as AnyRecord).fateArgumentPollution;
  }
});

test('argument merges do not mutate or retain mutable branches from either input', () => {
  const base = { name: Object.freeze({ locale: 'en' }), nested: [{ value: 1 }] };
  const scoped = { name: { format: 'short' }, tags: [{ value: 2 }] };
  const result = combineArgsPayload(base, scoped)!;
  expect(result).toEqual({
    name: { format: 'short', locale: 'en' },
    nested: [{ value: 1 }],
    tags: [{ value: 2 }],
  });
  expect(base.name).toEqual({ locale: 'en' });
  expect(scoped.name).toEqual({ format: 'short' });
  (result.nested as Array<AnyRecord>)[0].value = 3;
  (result.tags as Array<AnyRecord>)[0].value = 4;
  expect(base.nested[0].value).toBe(1);
  expect(scoped.tags[0].value).toBe(2);
});

test('scoped selection paths preserve prototype-named segments as data', () => {
  const args = { locale: 'en' };
  const scoped = scopeArgsPayload(args, '__proto__.constructor')!;
  expect(Object.getPrototypeOf(scoped)).toBeNull();
  expect(getArgsAtPath(scoped, '__proto__.constructor')).toEqual(args);
  const resolved = resolvedArgsFromPlan({
    args: new Map([['__proto__.constructor', { hash: hashArgs(args), value: args }]]),
    live: new Map(),
    paths: new Set(),
  })!;
  expect(Object.getPrototypeOf(resolved)).toBeNull();
  expect(getArgsAtPath(resolved, '__proto__.constructor')).toEqual(args);
  expect(Object.hasOwn(Object.prototype, 'locale')).toBe(false);
});
