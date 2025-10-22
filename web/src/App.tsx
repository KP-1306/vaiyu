import React, { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

/**
 * Helper: try to lazy-import a module; if it doesn't exist (or throws),
 * render the given Fallback component instead. This makes the build robust
 * when some routes aren't present yet in the repo or differ by path.
 */
function lazyOptional<T extends React.ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  Fallback: T
) {
  return lazy(async () => {
    try {
      return await importer();
    } catch (_err) {
      return { default: Fallback };
    }
  });
}

/* ---------- Tiny fallback screens (used if a route file is missing) ---------- */

const Placeholder: React.FC<{ title: string; note?: string }> = ({ title, note }) => (
  <div className="mx-auto max-w-3xl px-4 py-16">
    <h1 className="text-2xl font-semibold">{title}</h1>
    {note && <p className="mt-2 text-gray-600">{note}</p>}
  </div>
);

const FallbackMarketing = () => (
  <Placeholder
    title="VAiyu"
    note="Marketing page placeholder — replace with your MarketingHome component."
  />
);
const FallbackGuest = () => <Placeholder title="Guest dashboard" note="GuestDashboard is missing." />;
const FallbackOwner = () => <Placeholder title="Owner console" note="OwnerHome/OwnerConsole missing." />;
const FallbackStaff = () => <Placeholder title="Staff workspace" note="StaffHome is missing." />;
const FallbackSignIn = () => <Placeholder title="Sign in" note="SignIn route is missing." />;
const FallbackAuthCb = () => <Placeholder title="Signing you in…" note="AuthCallback is missing." />;
const FallbackProfile = () => <Placeholder title="Profile" note="Profile route is missing." />;
const FallbackSettings = () => <Placeholder title="Settings" note="Settings route is missing." />;
const FallbackLogout = () => <Placeholder title="Signing out…" note="Logout route is missing." />;

/* ---------- Try to load your real components; otherwise use fallbacks ---------- */

// Header and AccountBubble are optional; if absent we silently skip them.
const Header = lazyOptional(
  () => import("./components/Header"),
  (() => null) as unknown as React.ComponentType
);
const AccountBubble = lazyOptional(
  () => import("./components/AccountBubble"),
  (() => null) as unknown as React.ComponentType
);

// Marketing home (/) – change to your actual marketing component if present
const MarketingHome = lazyOptional(() => import("./routes/MarketingHome"), FallbackMarketing);

// Guest dashboard (/guest)
const GuestDashboard = lazyOptional(() => import("./routes/GuestDashboard"), FallbackGuest);

// Owner console list (/owner) and single-hotel home (/owner/:slug)
const OwnerConsole = lazyOptional(() => import("./routes/OwnerConsole"), FallbackOwner);
const OwnerHome = lazyOptional(() => import("./routes/OwnerHome"), FallbackOwner);

// Staff workspace (/staff)
const StaffHome = lazyOptional(() => import("./routes/StaffHome"), FallbackStaff);

// Auth flows
const SignIn = lazyOptional(() => import("./routes/SignIn"), FallbackSignIn);
const AuthCallback = lazyOptional(() => import("./routes/AuthCallback"), FallbackAuthCb);
const Logout = lazyOptional(() => import("./routes/Logout"), FallbackLogout);

// User settings
const Profile = lazyOptional(() => import("./routes/Profile"), FallbackProfile);
const Settings = lazyOptional(() => import("./routes/Settings"), FallbackSettings);

/* ---------- App shell ---------- */

const PageSpinner: React.FC = () => (
  <div className="grid h-40 place-items-center">
    <div className="animate-pulse text-gray-500">Loading…</div>
  </div>
);

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageSpinner />}>
        {/* Header is optional and lazy-loaded */}
        <Header />
        {/* AccountBubble only renders on marketing home when you want it */}
        <AccountBubble />

        <Suspense fallback={<PageSpinner />}>
          <Routes>
            {/* Marketing home */}
            <Route path="/" element={<MarketingHome />} />

            {/* Guest */}
            <Route path="/guest" element={<GuestDashboard />} />

            {/* Owner */}
            <Route path="/owner" element={<OwnerConsole />} />
            <Route path="/owner/:slug" element={<OwnerHome />} />

            {/* Staff */}
            <Route path="/staff" element={<StaffHome />} />

            {/* Auth */}
            <Route path="/signin" element={<SignIn />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/logout" element={<Logout />} />

            {/* User settings */}
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Suspense>
    </BrowserRouter>
  );
}
