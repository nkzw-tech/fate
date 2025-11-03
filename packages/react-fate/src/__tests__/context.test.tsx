/**
 * @vitest-environment happy-dom
 */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { useFateClient } from '../context.tsx';

// @ts-expect-error React 🤷‍♂️
global.IS_REACT_ACT_ENVIRONMENT = true;

const Component = () => {
  useFateClient();
  return null;
};

test('fails when the context was not provided', () => {
  const container = document.createElement('div');
  const root = createRoot(container);

  let caught: unknown;

  class ErrorBoundary extends React.Component<
    React.PropsWithChildren<{ onError?: (error: unknown) => void }>,
    { error: unknown }
  > {
    override state = { error: null as unknown };
    static getDerivedStateFromError(error: unknown) {
      return { error };
    }
    override componentDidCatch(error: unknown) {
      this.props.onError?.(error);
    }
    override render() {
      if (this.state.error) {
        return null;
      }
      return this.props.children;
    }
  }

  const consoleError = console.error;
  console.error = vi.fn();

  try {
    act(() => {
      root.render(
        <ErrorBoundary onError={(e) => (caught = e)}>
          <Component />
        </ErrorBoundary>,
      );
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      "react-fate: '<FateContext value={client}>' is missing.",
    );
  } finally {
    console.error = consoleError;
  }
});
