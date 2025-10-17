// web/src/components/RouteErrorBoundary.tsx
import React from "react";
import { Link, isRouteErrorResponse, useRouteError } from "react-router-dom";

/**
 * Simple route-level Error Boundary for React Router apps.
 * Works both as a class fallback for unexpected render crashes
 * and as an element for data/router errors via useRouteError.
 */

/* ---------- Element for data/router errors ---------- */
export function RouteErrorElement() {
  const err = useRouteError();
  let title = "Something went wrong";
  let message = "Unknown error. Check the console for details.";

  if (isRouteErrorResponse(err)) {
    title = `${err.status} – ${err.statusText}`;
    try {
      const bodyText =
        typeof err.data === "string" ? err.data : JSON.stringify(err.data);
      message = bodyText || message;
    } catch {
      /* ignore */
    }
  } else if (err instanceof Error) {
    message = err.message || message;
  }

  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-lg font-semibold mb-2">{title}</h1>
      <p className="text-red-600 mb-3">{message}</p>
      <div className="mt-4 flex gap-2">
        <Link to="/" className="btn btn-light">Back home</Link>
        <button className="btn" onClick={() => location.reload()}>Reload</button>
      </div>
    </main>
  );
}

/* ---------- Class boundary for render-time crashes ---------- */
export default class RouteErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: any }
> {
  state = { error: null as any };

  static getDerivedStateFromError(error: any) {
    return { error };
  }

  componentDidCatch(error: unknown, info: unknown) {
    // Useful while debugging:
    // eslint-disable-next-line no-console
    console.error("Route error:", error, info);
  }

  render() {
    if (this.state.error) {
      const e = this.state.error as any;
      const message =
        e?.message ?? e?.toString?.() ?? "Unknown error. See console.";
      return (
        <main className="max-w-3xl mx-auto p-6">
          <h1 className="text-lg font-semibold mb-2">Something went wrong</h1>
          <p className="text-red-600 mb-3">{message}</p>
          <pre className="p-3 rounded bg-gray-50 overflow-auto text-xs">
            {(e?.stack || "").toString()}
          </pre>
          <div className="mt-4 flex gap-2">
            <a href="/" className="btn btn-light">Back home</a>
            <button className="btn" onClick={() => location.reload()}>Reload</button>
          </div>
        </main>
      );
    }
    return this.props.children as React.ReactNode;
  }
}
