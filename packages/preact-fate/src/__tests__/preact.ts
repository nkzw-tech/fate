// Test helpers so the ported react-fate tests run on Preact (no preact/compat).
import { Fragment, render, type ComponentChildren } from 'preact';
import { act as preactAct } from 'preact/test-utils';
import { isThenable } from '../thenable.ts';

export { Suspense } from '../index.ts';
export { useEffect, useState } from 'preact/hooks';
export { Fragment as StrictMode };

// React-only root options such as `onCaughtError` are ignored.
export const createRoot = (container: Element, _options?: object) => ({
  render: (children: ComponentChildren) => render(children, container),
  unmount: () => render(null, container),
});

// React 19's async `act` keeps flushing until promises thrown to Suspense have
// settled and their retries rendered. Preact's `act` only awaits the callback,
// so give async callbacks a few macrotask turns to settle inside `act`.
export function act(callback: () => unknown): Promise<void> {
  let isAsync = false;
  const result = preactAct(() => {
    const value = callback();
    isAsync = isThenable(value);
    return value as void;
  });

  if (!isAsync) {
    return result;
  }

  return result.then(async () => {
    for (let i = 0; i < 5; i++) {
      await preactAct(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    }
  });
}
