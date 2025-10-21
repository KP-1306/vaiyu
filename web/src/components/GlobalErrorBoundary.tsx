import React from "react";

type Props = { children: React.ReactNode };
type State = { error?: Error };

export default class GlobalErrorBoundary extends React.Component<Props, State> {
  state: State = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to console so we can see it in the browser DevTools
    console.error("[App Crash]", error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="min-h-[60vh] grid place-items-center p-6">
        <div className="rounded-xl border p-6 max-w-lg w-full bg-white">
          <h1 className="text-lg font-semibold mb-1">Something went wrong</h1>
          <p className="text-sm text-gray-600 mb-3">We couldn’t render this route.</p>
          <pre className="text-xs bg-slate-50 p-3 rounded overflow-auto max-h-64">
            {this.state.error?.message}
          </pre>
          <button className="btn btn-light mt-3" onClick={()=>location.assign("/")}>Go Home</button>
        </div>
      </main>
    );
  }
}
