// web/src/routes/GuestDashboard.tsx
import { useEffect, useMemo, useState, memo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { API } from "../lib/api";

/* ===== Types ===== */
type Stay = { id: string; hotel: { name: string; city?: string }; check_in: string; check_out: string; bill_total?: number | null };
type Review = { id: string; hotel: { name: string }; rating: number; title?: string | null; created_at: string };
type Spend = { year: number; total: number };

type Source = "live" | "preview";
type AsyncData<T> = { loading: boolean; source: Source; data: T };

/* ===== Page ===== */
export default function GuestDashboard() {
  const nav = useNavigate();

  // auth snapshot
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // independent card states
  const [stays, setStays] = useState<AsyncData<Stay[]>>({
    loading: true,
    source: "live",
    data: [],
  });
  const [reviews, setReviews] = useState<AsyncData<Review[]>>({
    loading: true,
    source: "live",
    data: [],
  });
  const [spend, setSpend] = useState<AsyncData<Spend[]>>({
    loading: true,
    source: "live",
    data: [],
  });

  /* ---- Auth ---- */
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (!mounted) return;
      const u = data?.user;
      setEmail(u?.email ?? null);
      setName(u?.user_metadata?.name ?? null);
      setAvatarUrl((u?.user_metadata?.avatar_url as string) || null);

      const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
        if (!mounted) return;
        setEmail(sess?.user?.email ?? null);
        setName(sess?.user?.user_metadata?.name ?? null);
        setAvatarUrl((sess?.user?.user_metadata?.avatar_url as string) || null);
      });
      return () => sub.subscription.unsubscribe();
    })();
    return () => {
      mounted = false;
    };
  }, []);

  /* ---- Independent loads (graceful per-card fallback) ---- */
  useEffect(() => {
    loadCard(
      () => jsonWithTimeout(`${API}/me/stays?limit=5`),
      (j) => (Array.isArray(j?.items) ? j.items : []),
      () => demoStays(),
      (next) => setStays(next),
    );

    loadCard(
      () => jsonWithTimeout(`${API}/me/reviews?limit=5`),
      (j) => (Array.isArray(j?.items) ? j.items : []),
      () => demoReviews(),
      (next) => setReviews(next),
    );

    loadCard(
      () => jsonWithTimeout(`${API}/me/spend?years=5`),
      (j) => (Array.isArray(j?.items) ? j.items : []),
      () => demoSpend(),
      (next) => setSpend(next),
    );
  }, []);

  const firstName = (name || email || "Guest").split(" ")[0];
  const lastStay = stays.data[0];
  const welcomeText = useMemo(() => {
    if (lastStay?.hotel) {
      const city = lastStay.hotel.city ? ` in ${lastStay.hotel.city}` : "";
      return `Welcome back, ${firstName}! Hope you enjoyed ${lastStay.hotel.name}${city}.`;
    }
    return `Welcome, ${firstName}!`;
  }, [firstName, lastStay]);

  return (
    <main className="max-w-6xl mx-auto p-4 space-y-5" aria-labelledby="guest-dash-title">
      {/* Hero */}
      <section className="relative rounded-2xl p-6 bg-gradient-to-r from-sky-50 via-white to-indigo-50 border overflow-visible">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 id="guest-dash-title" className="text-xl font-semibold">{welcomeText}</h1>
            <p className="text-sm text-gray-600 mt-1">Your trips, bookings and bills — all in one place.</p>
          </div>
          <ProfileMenu
            email={email}
            avatarUrl={avatarUrl}
            onEditProfile={() => nav("/profile")}
          />
        </div>
      </section>

      {/* Top row */}
      <section className="grid md:grid-cols-3 gap-4">
        {/* Ad-hoc check-in only (no bookings yet) */}
        <Card
          title="Check-in"
          subtitle="Scan & go"
          icon={<CalendarIcon />}
        >
          <ArrivalCheckInEmpty />
        </Card>

        {/* Recent Stays */}
        <Card
          title="Recent stays"
          subtitle="Last 5 hotels"
          icon={<SuitcaseIcon />}
          badge={stays.source === "preview" ? "Preview" : undefined}
        >
          {stays.loading ? (
            <Skeleton lines={5} />
          ) : stays.data.length ? (
            <>
              <ul className="space-y-2 text-sm">
                {stays.data.map((s) => (
                  <li key={s.id} className="flex items-center justify-between">
                    <span>{s.hotel.name}{s.hotel.city ? `, ${s.hotel.city}` : ""}</span>
                    <span className="opacity-70">{fmtRange(s.check_in, s.check_out)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 text-right">
                <Link className="btn btn-light" to="/stays">View all stays</Link>
              </div>
            </>
          ) : (
            <Empty small text="No past stays yet." />
          )}
        </Card>

        {/* Spend */}
        <Card
          title="Spend summary"
          subtitle="By year"
          icon={<RupeeIcon />}
          badge={spend.source === "preview" ? "Preview" : undefined}
        >
          {spend.loading ? (
            <Skeleton lines={4} />
          ) : spend.data.length ? (
            <>
              <MiniBars data={spend.data} />
              <ul className="text-sm space-y-1 mt-3">
                {spend.data.map((s) => (
                  <li key={s.year} className="flex justify-between">
                    <span>{s.year}</span>
                    <span>₹ {Number(s.total || 0).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 text-right">
                <Link className="btn btn-light" to="/bills">Download bills</Link>
              </div>
            </>
          ) : (
            <Empty small text="No spend yet." />
          )}
        </Card>
      </section>

      {/* Reviews */}
      <section className="rounded-2xl p-4 shadow bg-white border">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-600 mb-1">Your latest reviews</div>
            <div className="text-xs text-gray-500">Edit or add context anytime.</div>
          </div>
        </div>

        <div className="mt-3">
          {reviews.loading ? (
            <Skeleton lines={3} />
          ) : reviews.data.length ? (
            <ul className="space-y-2">
              {reviews.data.map((rv) => (
                <li key={rv.id} className="text-sm">
                  <span className="font-semibold">{rv.hotel.name}</span> · {stars(rv.rating)} · {fmtDate(rv.created_at)}
                  {rv.title ? <> — <span className="opacity-80">{rv.title}</span></> : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="No reviews yet." />
          )}
        </div>

        {reviews.source === "preview" && (
          <div className="mt-3 text-xs text-gray-500">Showing a preview while we connect to your reviews.</div>
        )}
      </section>

      {/* Owner CTA */}
      <section className="rounded-2xl p-4 shadow bg-white border">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">Want to run a property?</div>
            <div className="text-sm text-gray-600">
              Register your hotel to unlock the owner console: dashboards, SLAs, workflows and AI moderation.
            </div>
          </div>
          <Link className="btn" to="/owner/register">Register your property</Link>
        </div>
      </section>
    </main>
  );
}

/* ===== Card loader helper (per-card resilience) ===== */
async function loadCard<J, T>(
  fetcher: () => Promise<J>,
  map: (j: J | null) => T,
  demo: () => T,
  set: (next: AsyncData<T>) => void,
) {
  set({ loading: true, source: "live", data: map(null as any) });
  try {
    const j = await fetcher();
    set({ loading: false, source: "live", data: map(j) });
  } catch {
    set({ loading: false, source: "preview", data: demo() });
  }
}

/* ===== Ad-hoc Check-in card content ===== */
function ArrivalCheckInEmpty() {
  return (
    <div className="text-sm text-gray-700">
      <div className="rounded-lg border-2 border-dashed p-4 bg-gray-50">
        <div className="font-medium">Arriving at a VAiyu hotel?</div>
        <p className="text-gray-600 mt-1">
          When you reach the property, scan the VAiyu QR at the front desk to fetch your booking and start check-in.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link className="btn" to="/scan">Scan property QR</Link>
          <Link className="btn btn-light" to="/claim">Enter booking code</Link>
          <Link className="btn btn-light" to="/hotel/sunrise">Explore hotels</Link>
        </div>
      </div>
    </div>
  );
}

/* ===== Profile menu (top-right in hero) ===== */
function ProfileMenu({
  email,
  avatarUrl,
  onEditProfile,
}: { email: string | null; avatarUrl: string | null; onEditProfile: () => void }) {
  const [open, setOpen] = useState(false);
  async function signOut() { await supabase.auth.signOut(); location.href = "/"; }
  const initial = (email?.[0]?.toUpperCase() ?? "G");
  return (
    <div className="relative">
      <button
        className="flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 shadow"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <div className="w-7 h-7 rounded-full overflow-hidden bg-indigo-600 text-white grid place-items-center text-xs font-semibold">
          {avatarUrl ? (
            <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
          ) : (
            initial
          )}
        </div>
        <span className="text-sm text-gray-700 max-w-[160px] truncate">{email || "Guest"}</span>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-56 rounded-xl border bg-white shadow-lg overflow-hidden z-50">
          <button
            role="menuitem"
            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => { setOpen(false); onEditProfile(); }}
          >
            Update profile
          </button>
          <Link role="menuitem" to="/settings" className="block px-3 py-2 text-sm hover:bg-gray-50">
            Settings
          </Link>
          <div className="border-t my-1" />
          <button
            role="menuitem"
            className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
            onClick={signOut}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ===== Reusable UI ===== */
const Card = memo(function Card({
  title, subtitle, icon, badge, children,
}: { title: string; subtitle?: string; icon?: React.ReactNode; badge?: string; children: React.ReactNode; }) {
  return (
    <div className="rounded-2xl p-4 shadow bg-white border">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon ? <div className="text-gray-600">{icon}</div> : null}
          <div>
            <div className="text-xs text-gray-500">{subtitle || ""}</div>
            <div className="font-semibold">{title}</div>
          </div>
        </div>
        {badge && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 border text-gray-700">{badge}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
});

/* ===== Icons (no extra deps) ===== */
function CalendarIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function SuitcaseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" {...props}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <rect x="8" y="3" width="8" height="4" rx="1" />
    </svg>
  );
}
function RupeeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" {...props}>
      <text x="5" y="17" fontSize="14" fontFamily="system-ui">₹</text>
      <line x1="9" y1="8" x2="18" y2="8" />
    </svg>
  );
}

/* ===== Small helpers ===== */
async function jsonWithTimeout(url: string, ms = 5000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  } finally {
    clearTimeout(t);
  }
}
function fmtDate(s: string) { try { return new Date(s).toLocaleString(); } catch { return s; } }
function fmtRange(a: string, b: string) {
  try {
    const A = new Date(a), B = new Date(b);
    return `${A.toLocaleDateString()} – ${B.toLocaleDateString()}`;
  } catch { return `${a} – ${b}`; }
}
function stars(n: number) {
  const c = Math.max(0, Math.min(5, Math.round(n)));
  return "★★★★★".slice(0, c) + "☆☆☆☆☆".slice(c);
}

/* ===== Demo fallbacks (only for failed cards) ===== */
function demoStays(): Stay[] {
  return [
    { id: "s1", hotel: { name: "Sunrise Suites", city: "Nainital" }, check_in: "2025-08-10T12:00:00Z", check_out: "2025-08-12T08:00:00Z", bill_total: 7420 },
    { id: "s2", hotel: { name: "Lakeside Inn", city: "Nainital" }, check_in: "2025-06-05T12:00:00Z", check_out: "2025-06-07T08:00:00Z", bill_total: 5810 },
    { id: "s3", hotel: { name: "Pine View", city: "Almora" }, check_in: "2025-04-01T12:00:00Z", check_out: "2025-04-03T08:00:00Z", bill_total: 3999 },
  ];
}
function demoReviews(): Review[] {
  return [
    { id: "r1", hotel: { name: "Sunrise Suites" }, rating: 5, title: "Great staff!", created_at: "2025-08-12T10:00:00Z" },
    { id: "r2", hotel: { name: "Lakeside Inn" }, rating: 4, title: "Beautiful view", created_at: "2025-06-07T09:00:00Z" },
  ];
}
function demoSpend(): Spend[] {
  const y = new Date().getFullYear();
  return [{ year: y, total: 13240 }, { year: y - 1, total: 19880 }, { year: y - 2, total: 0 }];
}

function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 rounded bg-gray-100 animate-pulse" />
      ))}
    </div>
  );
}
