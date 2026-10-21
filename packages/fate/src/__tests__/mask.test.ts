import { expect, test } from 'vite-plus/test';
import { addPath, fromPaths, isCovered, toPaths } from '../mask.ts';

test('does not grow descendants beneath an already covered parent', () => {
  const mask = fromPaths(['profile']);
  addPath(mask, 'profile.settings.theme');
  expect(isCovered(mask, 'profile.settings.theme')).toBe(true);
  expect(toPaths(mask)).toEqual(['profile']);
  expect(mask.children.get('profile')?.children.size).toBe(0);
});
