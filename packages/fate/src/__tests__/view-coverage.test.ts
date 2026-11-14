import { expect, test } from 'vite-plus/test';
import { addViewCoverage, mergeViewCoverage, ViewCoverageBuilder } from '../view-coverage.ts';

test('sharing coverage preserves both snapshots when either walk adds fields', () => {
  const child = new ViewCoverageBuilder();
  addViewCoverage(child, 'Item:1', 'title');
  const parent = new ViewCoverageBuilder();
  mergeViewCoverage(parent, child);
  expect(parent.get('Item:1')).toBe(child.get('Item:1'));
  addViewCoverage(child, 'Item:1', 'name');
  expect([...parent.get('Item:1')!]).toEqual(['title']);
  addViewCoverage(parent, 'Item:1', 'count');
  expect([...child.get('Item:1')!]).toEqual(['title', 'name']);
  expect([...parent.get('Item:1')!]).toEqual(['title', 'count']);
});

test('merging overlapping subtrees does not broaden cached child dependencies', () => {
  const first = new ViewCoverageBuilder([['Item:1', new Set(['title'])]]);
  const second = new ViewCoverageBuilder([['Item:1', new Set(['name'])]]);
  const parent = new ViewCoverageBuilder();
  mergeViewCoverage(parent, first);
  mergeViewCoverage(parent, second);
  expect([...parent.get('Item:1')!]).toEqual(['title', 'name']);
  expect([...first.get('Item:1')!]).toEqual(['title']);
  expect([...second.get('Item:1')!]).toEqual(['name']);
});

test('reusing a previous single-field set cannot retain removed dependencies or mutate it', () => {
  const previous = new ViewCoverageBuilder();
  addViewCoverage(previous, 'Item:1', 'title');
  addViewCoverage(previous, 'Item:2', 'title');
  previous.share();
  const next = new ViewCoverageBuilder(undefined, previous);
  addViewCoverage(next, 'Item:1', 'title');
  expect(next.get('Item:1')).toBe(previous.get('Item:1'));
  addViewCoverage(next, 'Item:1', 'name');
  expect([...next.get('Item:1')!]).toEqual(['title', 'name']);
  expect([...previous.get('Item:1')!]).toEqual(['title']);
  expect(next.has('Item:2')).toBe(false);
});
