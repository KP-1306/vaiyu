// web/src/App.tsx

import React, { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Header from "./components/Header";

// Workforce & jobs routes (required)
import WorkforceProfilePage from "./routes/WorkforceProfile";
import OwnerWorkforce from "./routes/OwnerWorkforce";
import PublicJobs from "./routes/PublicJobs";
import GuestWorkforceApply from "./routes/GuestWorkforceApply";

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

const FallbackPage: React.FC<{ title: string; hint?: string }> = ({
  title,
  hint,
}) => (
  <main className="mx-auto max-w-3xl px-4 py-10">
    <h1 className="text-xl font-semibold">{title}</h1>
    {hint ? <p className="mt-2 text-gray-600">{hint}</p> : null}
  </main>
);

/**
 * Fallback marketing page — only used when
 * web/src/routes/MarketingHome.tsx is missing.
 */
const FallbackMarketing: React.FC = () => (
  <main className="mx-auto max-w-3xl px-4 py-16">
    <div className="flex items-center gap-3">
      <img src="/brand/vaiyu-logo.png" alt="VAiyu" className="h-10 w-auto" />
      <h1 className="text-2xl font-semibold">VAiyu</h1>
    </div>
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

// Marketing home (landing)
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

// OwnerReputation (optional)
const OwnerReputation = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/OwnerReputation.{tsx,jsx}"
  ),
  () => (
    <FallbackPage
      title="Reputation radar"
      hint="Add web/src/routes/OwnerReputation.tsx to enable this page."
    />
  )
);

// --- marketing/legal pages (optional, safe if missing) ---
const AboutUs = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/AboutUs.{tsx,jsx}"
  ),
  () => (
    <FallbackPage
      title="About VAiyu"
      hint="Add web/src/routes/AboutUs.tsx to enable this page."
    />
  )
);

const AboutAI = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/AboutAI.{tsx,jsx}"
  ),
  () => (
    <FallbackPage
      title="How our AI works"
      hint="Add web/src/routes/AboutAI.tsx to enable this page."
    />
  )
);

const Contact = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/Contact.{tsx,jsx}"
  ),
  () => (
    <FallbackPage
      title="Contact"
      hint="Add web/src/routes/Contact.tsx to enable this page."
    />
  )
);

const Careers = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/Careers.{tsx,jsx}"
  ),
  () => (
    <FallbackPage
      title="Careers"
      hint="Add web/src/routes/Careers.tsx to enable this page."
    />
  )
);

const Press = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/Press.{tsx,jsx}"
  ),
  () => (
    <FallbackPage
      title="Press & Media"
      hint="Add web/src/routes/Press.tsx to enable this page."
    />
  )
);

const Privacy = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/Privacy.{tsx,jsx}"
  ),
  () => (
    <FallbackPage
      title="Privacy Policy"
      hint="Add web/src/routes/Privacy.tsx to enable this page."
    />
  )
);

// HRMS (optional)
const OwnerHRMS = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/OwnerHRMS.{tsx,jsx}"
  ),
  () => (
    <FallbackPage
      title="HRMS"
      hint="Add web/src/routes/OwnerHRMS.tsx to enable this page."
    />
  )
);

// Bookings calendar (optional)
const BookingsCalendar = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/BookingsCalendar.{tsx,jsx}"
  ),
  () => (
    <FallbackPage
      title="Bookings calendar"
      hint="Add web/src/routes/BookingsCalendar.tsx to enable this page."
    />
  )
);

// Owner pricing (optional)
const OwnerPricing = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/OwnerPricing.{tsx,jsx}"
  ),
  () => (
    <FallbackPage
      title="Pricing"
      hint="Add web/src/routes/OwnerPricing.tsx to enable this page."
    />
  )
);

// Owner occupancy (optional quick view)
const OwnerOccupancy = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/OwnerOccupancy.{tsx,jsx}"
  ),
  () => (
    <FallbackPage
      title="Occupancy"
      hint="Add web/src/routes/OwnerOccupancy.tsx to enable this page."
    />
  )
);

// Guest-facing “Jobs at this hotel” (optional)
const HotelJobs = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/HotelJobs.{tsx,jsx}"
  ),
  () => (
    <FallbackPage
      title="Jobs at this hotel"
      hint="Add web/src/routes/HotelJobs.tsx to show open roles."
    />
  )
);

/* --------- Required routes ---------- */

const GuestDashboard = lazy(() => import("./routes/GuestDashboard"));
const OwnerHome = lazy(() => import("./routes/OwnerHome"));
const SignIn = lazy(() => import("./routes/SignIn"));
const AuthCallback = lazy(() => import("./routes/AuthCallback"));
const OwnerGuestProfile = lazy(() => import("./routes/OwnerGuestProfile"));

// Ops board – uses existing OpsBoard.tsx (wraps Desk)
const OpsBoard = lazy(() => import("./routes/OpsBoard"));

// Revenue views – default + named exports from OwnerRevenue.tsx
const OwnerRevenue = lazy(() => import("./routes/OwnerRevenue"));
const OwnerADR = lazy(() =>
  import("./routes/OwnerRevenue").then((mod) => ({
    default: mod.OwnerADR,
  }))
);
const OwnerRevPAR = lazy(() =>
  import("./routes/OwnerRevenue").then((mod) => ({
    default: mod.OwnerRevPAR,
  }))
);

/* ---------------- App ---------------- */

export default function App() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <div className="min-h-screen bg-white flex flex-col">
        <Header />
        <main className="flex-1">
          <Routes>
            {/* Landing */}
            <Route path="/" element={<MarketingHome />} />

            {/* Guest core */}
            <Route path="/guest" element={<GuestDashboard />} />
            <Route path="/hotel/:slug/jobs" element={<HotelJobs />} />

            {/* Owner reputation */}
            <Route
              path="/owner/:slug/reputation"
              element={<OwnerReputation />}
            />

            {/* Guest → apply to a specific job at a property */}
            <Route
              path="/guest/:slug/jobs/:jobId/apply"
              element={<GuestWorkforceApply />}
            />

            {/* Owner guest profile (canonical + legacy aliases) */}
            <Route
              path="/owner/guest/:slug/:guestId"
              element={<OwnerGuestProfile />}
            />
            <Route
              path="/owner/guests/:guestId"
              element={<OwnerGuestProfile />}
            />
            <Route
              path="/owner/guest/:guestId"
              element={<OwnerGuestProfile />}
            />

            {/* Revenue views */}
            <Route path="/owner/:slug/revenue" element={<OwnerRevenue />} />
            <Route path="/owner/:slug/revenue/adr" element={<OwnerADR />} />
            <Route
              path="/owner/:slug/revenue/revpar"
              element={<OwnerRevPAR />}
            />

            {/* Occupancy view */}
            <Route
              path="/owner/:slug/occupancy"
              element={<OwnerOccupancy />}
            />

            {/* HRMS + Pricing */}
            <Route path="/owner/:slug/hrms" element={<OwnerHRMS />} />
            <Route path="/owner/:slug/pricing" element={<OwnerPricing />} />

            {/* NEW: Workforce hub (owner) */}
            <Route
              path="/owner/:slug/workforce"
              element={<OwnerWorkforce />}
            />

            {/* Catch-all owner console (kept last among /owner/*) */}
            <Route path="/owner/*" element={<OwnerHome />} />

            {/* Staff */}
            <Route path="/staff" element={<StaffHome />} />

            {/* Ops board – reuses Desk via OpsBoard */}
            <Route path="/ops" element={<OpsBoard />} />

            {/* Bookings calendar */}
            <Route
              path="/bookings/calendar"
              element={<BookingsCalendar />}
            />

            {/* Workforce profile (guest/staff) */}
            <Route
              path="/workforce/profile"
              element={<WorkforceProfilePage />}
            />

            {/* Public jobs index */}
            <Route path="/jobs/:slug" element={<PublicJobs />} />

            {/* Auth */}
            <Route path="/signin" element={<SignIn />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/logout" element={<Logout />} />

            {/* Marketing/Legal (optional) */}
            <Route path="/about" element={<AboutUs />} />
            <Route path="/about-ai" element={<AboutAI />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/careers" element={<Careers />} />
            <Route path="/press" element={<Press />} />
            <Route path="/privacy" element={<Privacy />} />

            {/* SPA fallback */}
            <Route path="*" element={<Navigate to="/guest" replace />} />
          </Routes>
        </main>
      </div>
    </Suspense>
  );
}
