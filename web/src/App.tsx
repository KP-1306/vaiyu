// web/src/App.tsx
import React, { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

/**
 * optionalLazy(pattern, Fallback)
 *  - Tries to find a matching file for the given Vite glob pattern.
 *  - If found, lazy-loads it.
 *  - If NOT found, returns a lazy component that renders the provided Fallback.
 *
 * Why: static `import()` must resolve at build time; if the file is missing, build fails.
 * `import.meta.glob` returns {} (empty) when nothing matches, which is safe.
 */
function optionalLazy<T extends React.ComponentType<any>>(
  pattern: string,
  Fallback: T
) {
  // Vite-only API. At build time, it expands into a map of possible modules.
  const matches = import.meta.glob<{ default: T }>(pattern);

  const first = Object.values(matches)[0];
  if (first) {
    // Found a file — load it lazily.
    return lazy(async () => {
      const mod = await first();
      return { default: (mod as any).default ?? (mod as any) };
    });
  }

  // No file matched — return a lazy component that just renders <Fallback />.
  return lazy(async () => ({ default: Fallback }));
}

/* ----------------- Fallbacks & shared UI ----------------- */

const FallbackMarketing: React.FC = () => (
  <main className="mx-auto max-w-3xl px-4 py-16">
    <h1 className="text-2xl font-semibold">VAiyu</h1>
    <p className="mt-2 text-gray-600">
      Marketing page is not available in this build. You’re seeing a safe
      fallback. (Add <code>web/src/routes/MarketingHome.tsx</code> to enable a
      full marketing homepage.)
    </p>
  </main>
);

const PageSpinner: React.FC = () => (
  <div className="grid min-h-[40vh] place-items-center text-sm text-gray-500">
    Loading…
  </div>
);

/* ----------------- Routes (lazy) ----------------- */

// ✅ Optional route: only load if the file exists (TSX or JSX)
const MarketingHome = optionalLazy(
  "./routes/MarketingHome.{tsx,jsx}",
  FallbackMarketing
);

// Normal lazy routes (these should exist)
const GuestDashboard = lazy(() => import("./routes/GuestDashboard"));
const OwnerHome = lazy(() => import("./routes/OwnerHome"));
const StaffHome = lazy(() => import("./routes/StaffHome"));
const SignIn = lazy(() => import("./routes/SignIn"));
const AuthCallback = lazy(() => import("./routes/AuthCallback"));
const Profile = lazy(() => import("./routes/Profile"));
const Settings = lazy(() => import("./routes/Settings"));
const Logout = lazy(() => import("./routes/Logout"));

/* ----------------- App Routes ----------------- */

export default function App() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Routes>
        {/* Marketing (optional). If you’d rather skip marketing entirely,
            swap this for: <Route path="/" element={<Navigate to="/guest" replace />} /> */}
        <Route path="/" element={<MarketingHome />} />

        {/* App areas */}
        <Route path="/guest" element={<GuestDashboard />} />
        <Route path="/owner/*" element={<OwnerHome />} />
        <Route path="/staff" element={<StaffHome />} />

        {/* Auth & account */}
        <Route path="/signin" element={<SignIn />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/logout" element={<Logout />} />

        {/* 404 → send people somewhere useful */}
        <Route path="*" element={<Navigate to="/guest" replace />} />
      </Routes>
    </Suspense>
  );
}
