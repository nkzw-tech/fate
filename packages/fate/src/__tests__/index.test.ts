import { expect, test } from 'vitest';

test('apples', () => {
  expect('apple').not.toEqual('banana');
});
