import React, { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

/**
 * optionalFromGlob(globRecord, Fallback)
 * - Accepts the record returned by a literal import.meta.glob() call
 * - If there is a match, lazy-loads it; else returns a lazy fallback
 *
 * NOTE: Vite requires import.meta.glob() args to be *string literals*.
 * We pass the record produced by the literal call into this helper.
 */
function optionalFromGlob<T extends React.ComponentType<any>>(
  globRecord: Record<string, () => Promise<{ default: T }>>,
  Fallback: T
) {
  const first = Object.values(globRecord)[0];
  if (first) {
    return lazy(async () => {
      const mod = await first();
      return { default: (mod as any).default ?? (mod as any) };
    });
  }
  return lazy(async () => ({ default: Fallback }));
}

/* ----------------- Fallbacks & shared UI ----------------- */

const FallbackMarketing: React.FC = () => (
  <main className="mx-auto max-w-3xl px-4 py-16">
    <h1 className="text-2xl font-semibold">VAiyu</h1>
    <p className="mt-2 text-gray-600">
      Marketing page is not included in this build. Add{" "}
      <code>web/src/routes/MarketingHome.tsx</code> to enable it.
    </p>
    <div className="mt-6">
      <a
        href="/guest"
        className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
      >
        Go to my trips
      </a>
    </div>
  </main>
);

const PageSpinner: React.FC = () => (
  <div className="grid min-h-[40vh] place-items-center text-sm text-gray-500">
    Loading…
  </div>
);

/* ----------------- Routes (lazy) ----------------- */

// ✅ Optional/marketing: use a *literal* glob and pass its record
const MarketingHome = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/MarketingHome.{tsx,jsx}"
  ),
  FallbackMarketing
);

// Normal lazy routes (these files should exist)
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
        {/* If you want to *skip* marketing entirely, replace this with:
             <Route path="/" element={<Navigate to="/guest" replace />} /> */}
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
