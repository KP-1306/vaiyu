import { Component, ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { hasError: boolean; message?: string };

export default class GlobalErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(err: unknown): State {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(error: any, info: any) {
    console.error('App crashed:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="mx-auto max-w-xl p-6">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-gray-600 mt-2">
            The app failed to start. We’ve logged the error in the console. Please refresh or try again.
          </p>
          {this.state.message && (
            <pre className="mt-3 rounded bg-gray-100 p-3 text-[12px] overflow-auto">{this.state.message}</pre>
          )}
        </main>
      );
    }
    return this.props.children;
  }
}
