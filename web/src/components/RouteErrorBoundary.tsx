// web/src/components/RouteErrorBoundary.tsx
import React from "react";
import { Link, isRouteErrorResponse, useRouteError } from "react-router-dom";

/** Spinner (lightweight) */
export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="min-h-[40vh] grid place-items-center text-sm text-gray-600">
      {label}
    </div>
  );
}

/** 1) Element for data/route loader/action errors */
export function RouteErrorElement() {
  const err = useRouteError() as unknown;
  let title = "Something went wrong";
  let message = "Unknown error. Check the console for details.";

  if (isRouteErrorResponse(err as any)) {
    const e = err as any;
    title = `${e.status} · ${e.statusText}`;
    try {
      const bodyText =
        typeof e.data === "string" ? e.data : JSON.stringify(e.data);
      message = bodyText || message;
    } catch {
      /* ignore JSON stringify errors */
    }
  } else if (err instanceof Error) {
    message = err.message || message;
  }

  // Log once for dev
  // eslint-disable-next-line no-console
  console.error("[RouteErrorElement]", err);

  return (
    <div className="mx-auto max-w-xl p-6 my-10 rounded-2xl border bg-white/50">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-gray-600">{message}</p>
      <div className="mt-4 flex gap-4 text-sm">
        <Link to="/" className="text-blue-600 underline">
          Go Home
        </Link>
        <button onClick={() => location.reload()} className="underline">
          Reload
        </button>
      </div>
    </div>
  );
}

/** 2) Class Error Boundary for render/runtime crashes */
export class RouteErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: any }
> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { error };
  }
  componentDidCatch(error: any, info: any) {
    // eslint-disable-next-line no-console
    console.error("[RouteErrorBoundary]", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-xl p-6 my-10 rounded-2xl border bg-white/50">
          <h2 className="text-lg font-semibold">Something went wrong on this page.</h2>
          <p className="mt-2 text-sm text-gray-600">
            We couldn’t render this route. Try reloading, or go back to Home.
          </p>
          <pre className="mt-3 overflow-auto max-h-48 text-xs bg-gray-50 p-3 rounded">
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <a href="/" className="inline-block mt-4 text-blue-600 underline">
            Go Home
          </a>
        </div>
      );
    }
    return this.props.children;
  }
}

/** 3) Helper to wrap elements with Suspense + Boundary */
export function withBoundary(node: React.ReactNode) {
  return (
    <RouteErrorBoundary>
      <React.Suspense fallback={<Spinner />}>{node}</React.Suspense>
    </RouteErrorBoundary>
  );
}

/** Default export kept for backward-compat imports */
export default RouteErrorBoundary;
