// web/src/App.tsx
import React, { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="min-h-[40vh] grid place-items-center text-sm text-gray-600">
      {label}
    </div>
  );
}

/** ✅ Proper error boundary */
class RouteErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: any }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { error };
  }
  componentDidCatch(error: unknown, info: unknown) {
    // helpful in DevTools
    console.error("Route error:", error, info);
  }
  render() {
    if (this.state.error) {
      const e = this.state.error as any;
      const message =
        e?.message ?? e?.toString?.() ?? "Unknown error. See console.";
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
    return this.props.children;
  }
}

// (optional)
function ScrollToTop() { return null; }

// Lazy pages (each of these files **must** default-export a component)
const HomeOrApp      = lazy(() => import("./routes/HomeOrApp"));
const GuestDashboard = lazy(() => import("./routes/GuestDashboard"));
const Profile        = lazy(() => import("./routes/Profile"));
const AuthCallback   = lazy(() => import("./routes/AuthCallback"));

// debug/health page
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
            {/* ── TEMP: set root to DebugOK to prove routing works ── */}
            {/* Change back to <HomeOrApp/> once confirmed */}
            <Route path="/" element={<DebugOK />} />

            <Route path="/guest" element={<GuestDashboard />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* You can still visit /debug directly */}
            <Route path="/debug" element={<DebugOK />} />

            <Route
              path="*"
              element={
                <div className="min-h-[40vh] grid place-items-center">
                  <div className="text-center">
                    <div className="text-3xl font-semibold">404</div>
                    <div className="mt-2 text-gray-600">
                      We couldn’t find that page.
                    </div>
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
