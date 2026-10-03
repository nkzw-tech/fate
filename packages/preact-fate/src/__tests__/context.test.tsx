/**
 * @vitest-environment happy-dom
 */

import { Component as PreactComponent, type ComponentChildren } from 'preact';
import { expect, test, vi } from 'vite-plus/test';
import { useFateClient } from '../context.ts';
import { act, createRoot } from './preact.ts';

const Component = () => {
  useFateClient();
  return null;
};

test('fails when the context was not provided', () => {
  const container = document.createElement('div');
  const root = createRoot(container);

  let caught: unknown;

  class ErrorBoundary extends PreactComponent<
    { children?: ComponentChildren; onError?: (error: unknown) => void },
    { error: unknown }
  > {
    override state = { error: null as unknown };
    static override getDerivedStateFromError(error: unknown) {
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
    expect((caught as Error).message).toBe("preact-fate: '<FateClient client={fate}>' is missing.");
  } finally {
    console.error = consoleError;
  }
});
