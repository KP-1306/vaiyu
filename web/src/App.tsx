// web/src/App.tsx
import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";

// PAGES — eager imports to avoid Suspense masking errors while we debug
import HomeOrApp from "./routes/HomeOrApp";
import GuestDashboard from "./routes/GuestDashboard";
import Profile from "./routes/Profile";
import AuthCallback from "./routes/AuthCallback";

/** Real error boundary (render-time crashes) */
class RouteErrorBoundary extends React.Component<
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
    // Helpful while debugging
    // eslint-disable-next-line no-console
    console.error("Route error:", error, info);
  }
  render() {
    if (this.state.error) {
      const e = this.state.error as any;
      const msg = e?.message ?? e?.toString?.() ?? "Unknown error. See console for details.";
      return (
        <main className="max-w-3xl mx-auto p-6">
          <h1 className="text-lg font-semibold mb-2">Something went wrong</h1>
          <p className="text-red-600 mb-3">{msg}</p>
          <pre className="p-3 rounded bg-gray-50 overflow-auto text-xs">
            {(e?.stack || "").toString()}
          </pre>
          <div className="mt-4">
            <a className="btn btn-light" href="/">Back home</a>
          </div>
        </main>
      );
    }
    return this.props.children as React.ReactNode;
  }
}

/** Known-good debug page */
function DebugOK() {
  return (
    <div className="min-h-[40vh] grid place-items-center">
      <div className="rounded-xl border bg-white shadow px-4 py-3">
        Router is working ✅
      </div>
    </div>
  );
}

/** Optional 404 element (kept inline) */
function NotFound() {
  return (
    <div className="min-h-[40vh] grid place-items-center">
      <div className="text-center">
        <div className="text-3xl font-semibold">404</div>
        <div className="mt-2 text-gray-600">We couldn’t find that page.</div>
        <Link className="btn mt-4" to="/">Go home</Link>
      </div>
    </div>
  );
}

export default function App() {
  // One-time: unregister any old service workers while we debug
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => {});
    }
  }, []);

  return (
    <BrowserRouter>
      <RouteErrorBoundary>
        <Routes>
          <Route path="/" element={<HomeOrApp />} />
          <Route path="/guest" element={<GuestDashboard />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* health-check route */}
          <Route path="/debug" element={<DebugOK />} />

          {/* 404 fallback */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </RouteErrorBoundary>
    </BrowserRouter>
  );
}
