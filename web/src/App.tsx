import React, { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

/**
 * optionalFromGlob(globRecord, Fallback)
 * Accepts the record returned by a *literal* import.meta.glob() call.
 * If a match exists, lazy-loads it; else returns a lazy fallback.
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

/* ---------------- Fallbacks & shared UI ---------------- */

const PageSpinner: React.FC = () => (
  <div className="grid min-h-[40vh] place-items-center text-sm text-gray-500">
    Loading…
  </div>
);

const FallbackMarketing: React.FC = () => (
  <main className="mx-auto max-w-3xl px-4 py-16">
    <h1 className="text-2xl font-semibold">VAiyu</h1>
    <p className="mt-2 text-gray-600">
      Marketing page is not included in this build.
      Add <code>web/src/routes/MarketingHome.tsx</code> to enable it.
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

const FallbackStaff: React.FC = () => (
  <main className="mx-auto max-w-3xl px-4 py-10">
    <h1 className="text-xl font-semibold">Staff workspace</h1>
    <p className="mt-2 text-gray-600">
      Staff workspace is not part of this build. To enable it, add{" "}
      <code>web/src/routes/StaffHome.tsx</code>.
    </p>
  </main>
);

/* ---------------- Routes (lazy/optional) ---------------- */

/** Optional marketing: literal glob + fallback */
const MarketingHome = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/MarketingHome.{tsx,jsx}"
  ),
  FallbackMarketing
);

/** Optional staff: literal glob + fallback (prevents build failure) */
const StaffHome = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/StaffHome.{tsx,jsx}"
  ),
  FallbackStaff
);

/** Regular routes that should exist */
const GuestDashboard = lazy(() => import("./routes/GuestDashboard"));
const OwnerHome = lazy(() => import("./routes/OwnerHome"));
const SignIn = lazy(() => import("./routes/SignIn"));
const AuthCallback = lazy(() => import("./routes/AuthCallback"));
const Profile = lazy(() => import("./routes/Profile"));
const Settings = lazy(() => import("./routes/Settings"));
const Logout = lazy(() => import("./routes/Logout"));

/* ---------------- App ---------------- */

export default function App() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Routes>
        {/* If you prefer to skip marketing entirely: 
             <Route path="/" element={<Navigate to="/guest" replace />} /> */}
        <Route path="/" element={<MarketingHome />} />

        <Route path="/guest" element={<GuestDashboard />} />
        <Route path="/owner/*" element={<OwnerHome />} />
        <Route path="/staff" element={<StaffHome />} />

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
