// web/src/App.tsx
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

// Tiny fallback UI
function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="min-h-[40vh] grid place-items-center text-sm text-gray-600">
      {label}
    </div>
  );
}

/** Global error boundary for any child route/component */
class RouteErrorBoundary extends (/* no types */ (Object as any)) {
  state: { error: any } = { error: null };
  static getDerivedStateFromError(error: any) {
    return { error };
  }
  componentDidCatch(error: unknown, info: unknown) {
    // eslint-disable-next-line no-console
    console.error("Route error:", error, info);
  }
  render() {
    if (this.state.error) {
      const e = this.state.error as any;
      const message =
        e?.message ??
        e?.toString?.() ??
        "Unknown error. Check the browser console for details.";
      return (
        <div className="max-w-3xl mx-auto p-6">
          <h1 className="text-lg font-semibold mb-2">Something went wrong</h1>
          <p className="text-red-600 mb-3">{message}</p>
          <pre className="p-3 rounded bg-gray-50 overflow-auto text-xs">
{(e?.stack || "").toString()}
          </pre>
          <div className="mt-4">
            <a href="/" className="btn btn-light">Back home</a>
          </div>
        </div>
      );
    }
    return this.props.children as any;
  }
}

// Optional: keep scroll position sane on route changes
function ScrollToTop() {
  return null;
}

// Lazy pages (each file **must** `export default` a component)
const HomeOrApp      = lazy(() => import("./routes/HomeOrApp"));
const GuestDashboard = lazy(() => import("./routes/GuestDashboard"));
const Profile        = lazy(() => import("./routes/Profile"));
const AuthCallback   = lazy(() => import("./routes/AuthCallback"));

// Known-good debug page (useful to confirm router health)
function DebugOK() {
  return (
    <div className="min-h-[40vh] grid place-items-center">
      <div className="rounded-xl border bg-white shadow px-4 py-3">
        Router is working ✅
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Suspense fallback={<Spinner />}>
        <RouteErrorBoundary>
          <Routes>
            <Route path="/" element={<HomeOrApp />} />
            <Route path="/guest" element={<GuestDashboard />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* health-check route */}
            <Route path="/debug" element={<DebugOK />} />

            {/* 404 */}
            <Route
              path="*"
              element={
                <div className="min-h-[40vh] grid place-items-center">
                  <div className="text-center">
                    <div className="text-3xl font-semibold">404</div>
                    <div className="mt-2 text-gray-600">We couldn’t find that page.</div>
                    <a href="/" className="btn mt-4">Go home</a>
                  </div>
                </div>
              }
            />
          </Routes>
        </RouteErrorBoundary>
      </Suspense>
    </BrowserRouter>
  );
}
