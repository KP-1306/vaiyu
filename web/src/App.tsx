import React, { Suspense, lazy, useEffect } from "react";
import {
  Routes,
  Route,
  Navigate,
  NavLink,
  Outlet,
  useParams,
  useLocation,
  useNavigate,
} from "react-router-dom";
import Header from "./components/Header";
import WorkforceProfilePage from "./routes/WorkforceProfile";
import OwnerWorkforce from "./routes/OwnerWorkforce";
import PublicJobs from "./routes/PublicJobs";
import GuestWorkforceApply from "./routes/GuestWorkforceApply";

/** Helper: optional lazy import from a literal glob + fallback */
function optionalFromGlob<T extends React.ComponentType<any>>(
  globRecord: Record<string, () => Promise<{ default: T }>>,
  Fallback: T,
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
 * Now shows the VAiyu logo from /brand/vaiyu-logo.png.
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
    "./routes/MarketingHome.{tsx,jsx}",
  ),
  FallbackMarketing,
);

// Staff task manager
const StaffTaskManager = lazy(() => import("./routes/StaffTaskManager"));

// Settings (optional)
const Settings = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/Settings.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="Settings"
      hint="Add web/src/routes/Settings.tsx to enable this page."
    />
  ),
);

// Profile (optional)
const Profile = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/Profile.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="Profile"
      hint="Add web/src/routes/Profile.tsx to enable this page."
    />
  ),
);

// Logout (optional)
const Logout = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/Logout.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="Sign out"
      hint="Add web/src/routes/Logout.tsx to enable this page."
    />
  ),
);

// OwnerReputation (optional)
const OwnerReputation = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/OwnerReputation.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="Reputation radar"
      hint="Add web/src/routes/OwnerReputation.tsx to enable this page."
    />
  ),
);

// --- marketing/legal pages (optional, safe if missing) ---
const AboutUs = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/AboutUs.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="About VAiyu"
      hint="Add web/src/routes/AboutUs.tsx to enable this page."
    />
  ),
);

const AboutAI = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/AboutAI.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="How our AI works"
      hint="Add web/src/routes/AboutAI.tsx to enable this page."
    />
  ),
);

const Contact = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/Contact.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="Contact"
      hint="Add web/src/routes/Contact.tsx to enable this page."
    />
  ),
);

const Careers = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/Careers.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="Careers"
      hint="Add web/src/routes/Careers.tsx to enable this page."
    />
  ),
);

const Press = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/Press.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="Press & Media"
      hint="Add web/src/routes/Press.tsx to enable this page."
    />
  ),
);

const Privacy = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/Privacy.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="Privacy Policy"
      hint="Add web/src/routes/Privacy.tsx to enable this page."
    />
  ),
);

// HRMS (optional)
const OwnerHRMS = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/OwnerHRMS.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="HRMS"
      hint="Add web/src/routes/OwnerHRMS.tsx to enable this page."
    />
  ),
);

// Bookings calendar (optional)
const BookingsCalendar = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/BookingsCalendar.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="Bookings calendar"
      hint="Add web/src/routes/BookingsCalendar.tsx to enable this page."
    />
  ),
);

// Owner pricing (optional)
const OwnerPricing = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/OwnerPricing.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="Pricing"
      hint="Add web/src/routes/OwnerPricing.tsx to enable this page."
    />
  ),
);

// Owner occupancy (optional quick view)
const OwnerOccupancy = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/OwnerOccupancy.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="Occupancy"
      hint="Add web/src/routes/OwnerOccupancy.tsx to enable this page."
    />
  ),
);

// Guest-facing “Jobs at this hotel” page (optional)
const HotelJobs = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/HotelJobs.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="Jobs at this hotel"
      hint="Add web/src/routes/HotelJobs.tsx to show open roles for this property."
    />
  ),
);

/* --------- Guest core secondary pages (optional-safe) ---------- */

const Stays = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/Stays.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="My trips"
      hint="Add web/src/routes/Stays.tsx to enable the stays list."
    />
  ),
);

const Bills = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/Bills.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="Bills & invoices"
      hint="Add web/src/routes/Bills.tsx to enable invoices."
    />
  ),
);

const ClaimStay = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/ClaimStay.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="Claim booking"
      hint="Add web/src/routes/ClaimStay.tsx to enable booking claim."
    />
  ),
);

const Scan = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/Scan.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="Scan"
      hint="Add web/src/routes/Scan.tsx to enable QR check-in."
    />
  ),
);

const Rewards = optionalFromGlob(
  import.meta.glob<{ default: React.ComponentType<any> }>(
    "./routes/Rewards.{tsx,jsx}",
  ),
  () => (
    <FallbackPage
      title="Rewards"
      hint="Add web/src/routes/Rewards.tsx to enable rewards."
    />
  ),
);

/* --------- Required routes ---------- */

const GuestDashboard = lazy(() => import("./routes/GuestDashboard"));
const Stay = lazy(() => import("./routes/Stay"));
const MyRequests = lazy(() => import("./routes/MyRequests"));
const Checkout = lazy(() => import("./routes/Checkout"));

const OwnerHome = lazy(() => import("./routes/OwnerHome"));
const SignIn = lazy(() => import("./routes/SignIn"));
const AuthCallback = lazy(() => import("./routes/AuthCallback"));
const OwnerGuestProfile = lazy(() => import("./routes/OwnerGuestProfile"));

// Request tracker page
const RequestTracker = lazy(() => import("./routes/RequestTracker"));

// Owner property dashboard
const OwnerDashboard = lazy(() => import("./routes/OwnerDashboard"));

// Ops board – uses existing OpsBoard.tsx (wraps Desk)
const OpsBoard = lazy(() => import("./routes/OpsBoard"));
const OwnerStaffShifts = lazy(() => import("./routes/OwnerStaffShifts"));

// Revenue views – default + named exports from OwnerRevenue.tsx
const OwnerRevenue = lazy(() => import("./routes/OwnerRevenue"));
const OwnerADR = lazy(() =>
  import("./routes/OwnerRevenue").then((mod) => ({
    default: mod.OwnerADR,
  })),
);
const OwnerRevPAR = lazy(() =>
  import("./routes/OwnerRevenue").then((mod) => ({
    default: mod.OwnerRevPAR,
  })),
);

// OwnerAnalytics
const OwnerAnalyticsRoute = lazy(() => import("./routes/OwnerAnalytics"));
// OpsManagerAnalytics
const OpsManagerAnalytics = lazy(() => import("./routes/OpsManagerAnalytics"));

// Owner feature flags (for sidebar)

/* --------- Owner feature flags (for sidebar) ---------- */

const HAS_REVENUE = import.meta.env.VITE_HAS_REVENUE === "true";
const HAS_HRMS = import.meta.env.VITE_HAS_HRMS === "true";
const HAS_CALENDAR = import.meta.env.VITE_HAS_CALENDAR === "true";
const HAS_WORKFORCE =
  import.meta.env.VITE_HAS_WORKFORCE === "false" ? false : true;

/* --------- Owner layout + sidebar ---------- */

type OwnerLayoutProps = {
  children?: React.ReactNode;
};

/**
 * OwnerLayout
 * - Provides a left navigation rail for all property-specific owner pages.
 * - Wraps individual routes (Dashboard, Revenue, HRMS, Workforce, etc.).
 * - Does NOT change existing OwnerHome (/owner) behaviour.
 */
function OwnerLayout({ children }: OwnerLayoutProps) {
  const { slug } = useParams();
  const base =
    slug && slug.trim() ? `/owner/${encodeURIComponent(slug.trim())}` : "/owner";

  return (
    <div className="owner-layout flex min-h-[calc(100vh-4rem)] bg-slate-50">
      {/* Left nav – hidden on very small screens for now */}
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white/95 px-3 py-4 md:block">
        <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Owner console
        </div>
        <OwnerSidebar basePath={base} />
      </aside>
      {/* Content area */}
      <div className="flex-1 px-3 py-3 md:px-4 md:py-4 overflow-x-hidden">
        {children ?? <Outlet />}
      </div>
    </div>
  );
}

function OwnerSidebar({ basePath }: { basePath: string }) {
  // Ensure no trailing slash
  const base = basePath.replace(/\/+$/, "");

  type Item = {
    label: string;
    to: string;
    feature?: "revenue" | "hrms" | "calendar" | "workforce";
  };
  const items: Item[] = [
    {
      label: "Today’s dashboard",
      to: `${base}/dashboard`,
    },
    {
      label: "Rooms & occupancy",
      to: `${base}/occupancy`,
    },
    HAS_REVENUE && {
      label: "Revenue & forecast",
      to: `${base}/revenue`,
      feature: "revenue",
    },
    HAS_HRMS && {
      label: "HR & attendance",
      to: `${base}/hrms`,
      feature: "hrms",
    },
    HAS_WORKFORCE && {
      label: "Workforce & hiring",
      to: `${base}/workforce`,
      feature: "workforce",
    },
    {
      label: "Reviews & reputation",
      to: `${base}/reputation`,
    },
    HAS_CALENDAR && {
      label: "Bookings calendar",
      to: `${base}/bookings/calendar`,
      feature: "calendar",
    },
    {
      label: "Property settings",
      to: `${base}/settings`,
    },
  ].filter(Boolean) as Item[];

  // Add Analytics link (inserted dynamically)
  const analyticsItem: Item = {
    label: "Ops & Analytics",
    to: `${base}/analytics`,
  };
  // Insert after Dashboard
  items.splice(1, 0, analyticsItem);

  return (
    <nav className="space-y-1 text-sm">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            [
              "flex items-center justify-between rounded-xl px-3 py-2",
              "text-[13px] transition-colors",
              isActive
                ? "bg-slate-900 text-slate-50"
                : "text-slate-700 hover:bg-slate-100",
            ].join(" ")
          }
        >
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/* --------- Deep-link handler for ticketId & from= ---------- */

function useDeepLinkHandler() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ticketId = params.get("ticketId");
    const from = params.get("from");

    // 1) Direct ticketId param, e.g. "/?ticketId=UUID"
    if (ticketId) {
      console.debug("[VAiyu_FE] DeepLink: ticketId param detected", {
        ticketId,
        pathname: location.pathname,
        search: location.search,
      });

      navigate(`/requestTracker/${encodeURIComponent(ticketId)}`, {
        replace: true,
      });
      return;
    }

    // 2) Bounce from 404.html: "/?from=/requestTracker/UUID"
    if (from) {
      try {
        const url = new URL(from, window.location.origin);
        if (url.pathname.startsWith("/requestTracker/")) {
          const id = url.pathname.split("/requestTracker/")[1] || "";
          if (id) {
            console.debug(
              "[VAiyu_FE] DeepLink: from param for requestTracker",
              {
                from,
                id,
              },
            );
            navigate(`/requestTracker/${encodeURIComponent(id)}`, {
              replace: true,
            });
          }
        } else {
          console.debug("[VAiyu_FE] DeepLink: from param (non-requestTracker)", {
            from,
          });
        }
      } catch (err) {
        console.warn("[VAiyu_FE] DeepLink: failed to parse 'from' param", err);
      }
    }
  }, [location.pathname, location.search, navigate]);
}

/* ---------------- App ---------------- */

export default function App() {
  // Handle deep-links from "/?ticketId=…" or "/?from=…"
  useDeepLinkHandler();

  return (
    <Suspense fallback={<PageSpinner />}>
      <div className="min-h-screen bg-white flex flex-col">
        <Header />
        <main className="flex-1">
          <Routes>
            {/* Landing */}
            <Route path="/" element={<MarketingHome />} />

            {/* Marketing / info (optional) */}
            <Route path="/about" element={<AboutUs />} />
            <Route path="/about-ai" element={<AboutAI />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/careers" element={<Careers />} />
            <Route path="/press" element={<Press />} />
            <Route path="/privacy" element={<Privacy />} />

            {/* Auth */}
            <Route path="/signin" element={<SignIn />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/logout" element={<Logout />} />

            {/* Guest core */}
            <Route path="/guest" element={<GuestDashboard />} />
            <Route path="/stays" element={<Stays />} />
            <Route path="/bills" element={<Bills />} />
            <Route path="/claim" element={<ClaimStay />} />
            <Route path="/scan" element={<Scan />} />
            <Route path="/rewards" element={<Rewards />} />

            {/* Stay + checkout */}
            <Route path="/stay/:id" element={<Stay />} />
            <Route path="/stay/:code/requests" element={<MyRequests />} />
            {/* Support both /checkout/:code and /checkout */}
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/checkout/:code" element={<Checkout />} />

            {/* Guest Jobs */}
            <Route path="/hotel/:slug/jobs" element={<HotelJobs />} />
            <Route
              path="/guest/:slug/jobs/:jobId/apply"
              element={<GuestWorkforceApply />}
            />

            {/* Workforce public */}
            <Route path="/workforce/profile" element={<WorkforceProfilePage />} />
            <Route path="/workforce/jobs" element={<PublicJobs />} />
            {/* alias */}
            <Route path="/jobs" element={<PublicJobs />} />

            {/* Staff task manager */}
            <Route path="/staff" element={<StaffTaskManager />} />

            {/* Ops board */}
            <Route path="/ops" element={<OpsBoard />} />
            <Route path="/ops/analytics" element={<OpsManagerAnalytics />} />

            {/* Staff & Shifts (new) */}
            <Route
              path="/owner/:slug/staff-shifts"
              element={
                <OwnerLayout>
                  <OwnerStaffShifts />
                </OwnerLayout>
              }
            />

            {/* Request tracker route – friendly displayId param */}
            <Route
              path="/track/:displayId"
              element={<RequestTracker />}
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

            {/* Owner home (property picker / hub) */}
            <Route path="/owner" element={<OwnerHome />} />

            {/* Owner – property-specific layout + pages */}
            <Route
              path="/owner/:slug/analytics"
              element={
                <OwnerLayout>
                  <OwnerAnalyticsRoute />
                </OwnerLayout>
              }
            />
            <Route
              path="/owner/:slug/dashboard"
              element={
                <OwnerLayout>
                  <OwnerDashboard />
                </OwnerLayout>
              }
            />
            <Route
              path="/owner/:slug/reputation"
              element={
                <OwnerLayout>
                  <OwnerReputation />
                </OwnerLayout>
              }
            />
            <Route
              path="/owner/:slug/workforce"
              element={
                <OwnerLayout>
                  <OwnerWorkforce />
                </OwnerLayout>
              }
            />
            <Route
              path="/owner/:slug/revenue"
              element={
                <OwnerLayout>
                  <OwnerRevenue />
                </OwnerLayout>
              }
            />
            <Route
              path="/owner/:slug/revenue/adr"
              element={
                <OwnerLayout>
                  <OwnerADR />
                </OwnerLayout>
              }
            />
            <Route
              path="/owner/:slug/revenue/revpar"
              element={
                <OwnerLayout>
                  <OwnerRevPAR />
                </OwnerLayout>
              }
            />
            <Route
              path="/owner/:slug/occupancy"
              element={
                <OwnerLayout>
                  <OwnerOccupancy />
                </OwnerLayout>
              }
            />
            <Route
              path="/owner/:slug/hrms"
              element={
                <OwnerLayout>
                  <OwnerHRMS />
                </OwnerLayout>
              }
            />
            {/* Alias so /owner/:slug/hrms/attendance also works */}
            <Route
              path="/owner/:slug/hrms/attendance"
              element={
                <OwnerLayout>
                  <OwnerHRMS />
                </OwnerLayout>
              }
            />
            <Route
              path="/owner/:slug/pricing"
              element={
                <OwnerLayout>
                  <OwnerPricing />
                </OwnerLayout>
              }
            />
            <Route
              path="/owner/:slug/bookings/calendar"
              element={
                <OwnerLayout>
                  <BookingsCalendar />
                </OwnerLayout>
              }
            />
            {/* Settings in property context – reuse Settings component */}
            <Route
              path="/owner/:slug/settings"
              element={
                <OwnerLayout>
                  <Settings />
                </OwnerLayout>
              }
            />

            {/* Global settings/profile (non-property scoped) */}
            <Route path="/settings" element={<Settings />} />
            <Route path="/profile" element={<Profile />} />

            {/* Legacy safe redirects */}
            <Route path="/guest/dashboard" element={<Navigate to="/guest" replace />} />

            {/* 404 */}
            <Route
              path="*"
              element={
                <FallbackPage
                  title="Page not found"
                  hint="The link may be outdated. Use the main navigation to continue."
                />
              }
            />
          </Routes>
        </main>
      </div>
    </Suspense>
  );
}
