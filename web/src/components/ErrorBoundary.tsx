import React from "react";
import { captureError } from "../lib/sentry";

type State = { hasError: boolean; details?: string };

export default class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, info: React.ErrorInfo) {
    captureError(error, { componentStack: info.componentStack });
    const details = (error?.stack || String(error)) + "\n" + info.componentStack;
    this.setState({ details });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="min-h-[60vh] grid place-items-center px-6">
        <div className="max-w-lg w-full rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="mt-1 text-sm">
            The page crashed. You can reload, or copy details and send them to us.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              className="btn"
              onClick={() => location.reload()}
              autoFocus
            >
              Reload
            </button>
            {this.state.details && (
              <button
                className="btn btn-light"
                onClick={() => {
                  navigator.clipboard?.writeText(this.state.details!);
                }}
                title="Copy error details"
              >
                Copy details
              </button>
            )}
            <a
              className="btn btn-light"
              href={`mailto:hello@vaiyu.co.in?subject=Crash%20report&body=${encodeURIComponent(this.state.details || "")}`}
            >
              Email us
            </a>
          </div>
        </div>
      </main>
    );
  }
}
