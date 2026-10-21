import { expect, test } from 'vite-plus/test';
import { addPath, fromPaths, isCovered, toPaths } from '../mask.ts';

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
