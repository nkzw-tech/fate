import { expect, test } from 'vite-plus/test';
import {
  addPath,
  cloneMask,
  emptyMask,
  fromPaths,
  isCovered,
  removePath,
  toPaths,
  union,
} from '../mask.ts';

test('keeps empty masks, clones, and unions independent when coverage changes', () => {
  const first = emptyMask();
  const second = emptyMask();
  addPath(first, 'profile.name');
  expect(toPaths(second)).toEqual([]);
  const clone = cloneMask(first);
  union(second, first);
  removePath(first, 'profile.name');
  addPath(first, 'profile.bio');
  addPath(clone, 'name');
  union(second, fromPaths(['profile']));
  removePath(second, 'profile.name');
  expect(toPaths(first)).toEqual(['profile.bio']);
  expect(toPaths(clone)).toEqual(['profile.name', 'name']);
  expect(toPaths(second)).toEqual([]);
});

test('does not grow descendants beneath an already covered parent', () => {
  const mask = fromPaths(['profile']);
  addPath(mask, 'profile.settings.theme');
  expect(isCovered(mask, 'profile.settings.theme')).toBe(true);
  expect(toPaths(mask)).toEqual(['profile']);
  expect(mask.children.get('profile')?.children.size).toBe(0);
});

test.each(['name', 'profile.name', '', '.name', 'profile.', 'profile..name'])(
  'preserves the segments of %j',
  (path) => {
    const mask = fromPaths([path]);
    expect(isCovered(mask, path)).toBe(true);
    let current = mask;
    for (const segment of path.split('.')) {
      expect(current.children.has(segment)).toBe(true);
      current = current.children.get(segment)!;
    }
    expect(current.all).toBe(true);
    expect(current.children.size).toBe(0);
  },
);

test('removing the last nested path does not mark its empty ancestors as covered', () => {
  const mask = fromPaths(['profile.image.color', 'name']);
  removePath(mask, 'profile.image.color');
  expect(isCovered(mask, 'profile')).toBe(false);
  expect(isCovered(mask, 'profile.image')).toBe(false);
  expect(isCovered(mask, 'name')).toBe(true);
  expect(toPaths(mask)).toEqual(['name']);
});
