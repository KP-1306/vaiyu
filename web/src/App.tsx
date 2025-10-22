import React, { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

/** Helper: optional lazy import from a literal glob + fallback */
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

/* ---------------- Shared UI ---------------- */

const PageSpinner: React.FC = () => (
  <div className="grid min-h-[40vh] place-items-center text-sm text-gray-500">
    Loading…
  </div>
);

const FallbackPage: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <main className="mx-auto max-w-3xl px-4 py-10">
    <h1 className="text-xl font-semibold">{title}</h1>
    {hint ? <p className="mt-2 text-gray-600">{hint}</p> : null}
  </main>
);

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

/* --------- Optional routes (hardened) ---------- */

// Marketing (optional)
const MarketingHome = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/MarketingHome.{tsx,jsx}"
  ),
  FallbackMarketing
);

// Staff (optional)
const StaffHome = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/StaffHome.{tsx,jsx}"
  ),
  () => (
    <FallbackPage
      title="Staff workspace"
      hint="Add web/src/routes/StaffHome.tsx to enable this page."
    />
  )
);

// Settings (optional)
const Settings = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/Settings.{tsx,jsx}"
  ),
  () => (
    <FallbackPage
      title="Settings"
      hint="Add web/src/routes/Settings.tsx to enable this page."
    />
  )
);

// Profile (optional)
const Profile = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/Profile.{tsx,jsx}"
  ),
  () => (
    <FallbackPage
      title="Profile"
      hint="Add web/src/routes/Profile.tsx to enable this page."
    />
  )
);

// Logout (optional)
const Logout = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/Logout.{tsx,jsx}"
  ),
  () => (
    <FallbackPage
      title="Sign out"
      hint="Add web/src/routes/Logout.tsx to enable this page."
    />
  )
);

/* --------- Required routes ---------- */

const GuestDashboard = lazy(() => import("./routes/GuestDashboard"));
const OwnerHome = lazy(() => import("./routes/OwnerHome"));
const SignIn = lazy(() => import("./routes/SignIn"));
const AuthCallback = lazy(() => import("./routes/AuthCallback"));

/* ---------------- App ---------------- */

export default function App() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Routes>
        {/* If you want the app to land directly on /guest, change this line to:
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

        {/* 404 */}
        <Route path="*" element={<Navigate to="/guest" replace />} />
      </Routes>
    </Suspense>
  );
}
