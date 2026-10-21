import { expect, test } from 'vite-plus/test';
import { getStoragePath } from '../field-key.ts';
import type { SelectionPlan } from '../selection.ts';

const plan: SelectionPlan = {
  args: new Map([
    ['projects.name', { hash: 'locale:ja_JP', value: { locale: 'ja_JP' } }],
    ['projects.headline:name', { hash: 'locale:en_US', value: { locale: 'en_US' } }],
    ['projects.owner', { hash: 'region:JP', value: { region: 'JP' } }],
    ['projects.owner.handle:username', { hash: 'language:ja', value: { language: 'ja' } }],
  ]),
  live: new Map(),
  paths: new Set(),
};

test.each([
  ['id', '', 'id'],
  ['id', 'projects', 'id'],
  ['name', 'projects', 'name(locale%3Aja_JP)'],
  ['headline:name', 'projects', 'name(locale%3Aen_US)'],
  ['headline:name', '', 'name'],
  ['owner.handle:username', 'projects', 'owner(region%3AJP).username(language%3Aja)'],
  ['owner.username', 'projects', 'owner(region%3AJP).username'],
  ['', 'projects', ''],
])('resolves storage path %s beneath %s', (path, prefix, expected) => {
  expect(getStoragePath(path, plan, prefix)).toBe(expected);
});

test('resolves field aliases without an argument plan', () => {
  expect(getStoragePath('headline:name')).toBe('name');
  expect(getStoragePath('owner.handle:username')).toBe('owner.username');
});
