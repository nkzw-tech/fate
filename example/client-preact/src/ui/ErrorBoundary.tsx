import { Component, h, type ComponentChildren, type ComponentType } from 'preact';

export type FallbackProps = {
  error: unknown;
  resetErrorBoundary: () => void;
};

type ErrorBoundaryProps = {
  children?: ComponentChildren;
} & (
  | { fallbackRender: (props: FallbackProps) => ComponentChildren }
  | { FallbackComponent: ComponentType<FallbackProps> }
);

type ErrorBoundaryState = { error: { value: unknown } | null };

/**
 * The parts of `react-error-boundary` used by the example: renders
 * `fallbackRender` or `FallbackComponent` with the caught error and a
 * `resetErrorBoundary` callback.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static override getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    // Thrown promises belong to the nearest <Suspense> boundary.
    if (error != null && typeof (error as PromiseLike<unknown>).then === 'function') {
      throw error;
    }

    return { error: { value: error } };
  }

  override componentDidCatch(error: unknown) {
    // React logs errors caught by boundaries; Preact does not.
    // eslint-disable-next-line no-console
    console.error(error);
  }

  resetErrorBoundary = () => this.setState({ error: null });

  override render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    const props: FallbackProps = {
      error: error.value,
      resetErrorBoundary: this.resetErrorBoundary,
    };

    return 'fallbackRender' in this.props
      ? this.props.fallbackRender(props)
      : h(this.props.FallbackComponent, props);
  }
}
