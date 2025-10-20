// web/src/routes/OwnerDashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Spinner from "../components/Spinner";
import BackHome from "../components/BackHome";

/** ========= Types ========= */
type Hotel = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
};

type StayRow = {
  id: string;
  guest_id: string;
  check_in_start: string | null;
  check_out_end: string | null;
  status: string | null;
  room: string | null;
};

type KpisToday = {
  hotel_id: string;
  d: string; // date
  total_rooms: number | null;
  inhouse: number | null;
  arrivals: number | null;
  departures: number | null;
  room_revenue_today: number | null;
  occupied_rooms_today: number | null;
  // Optional deltas/extra fields you may later add to the view:
  occ_delta?: number | null;
  adr_delta?: number | null;
  revpar_delta?: number | null;
  pickup7d?: number | null;
};

/** Optional Edge Functions guard (keep false until you actually deploy them) */
const HAS_FUNCS = import.meta.env.VITE_HAS_FUNCS === "true";

/** ========= Page ========= */
export default function OwnerDashboard() {
  const { slug } = useParams();
  const [params] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [hotel, setHotel] = useState<Hotel | null>(null);

  const [arrivals, setArrivals] = useState<StayRow[]>([]);
  const [inhouse, setInhouse] = useState<StayRow[]>([]);
  const [departures, setDepartures] = useState<StayRow[]>([]);

  const [totalRooms, setTotalRooms] = useState<number>(0);

  // New: KPIs from an optional view; we fall back if absent
  const [kpis, setKpis] = useState<KpisToday | null>(null);

  const [accessProblem, setAccessProblem] = useState<string | null>(null);
  const inviteToken = params.get("invite");
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    if (!slug) {
      setLoading(false);
      setAccessProblem("Missing property slug in the URL.");
      return;
    }

    let alive = true;
    (async () => {
      setLoading(true);
      setAccessProblem(null);

      // 1) Hotel (RLS-gated)
      const { data: hotelRow, error: hErr } = await supabase
        .from("hotels")
        .select("id,name,slug,city")
        .eq("slug", slug)
        .limit(1)
        .maybeSingle();

      if (!alive) return;

      if (hErr || !hotelRow) {
        console.error("[OwnerDashboard] hotel read failed:", hErr);
        setHotel(null);
        setArrivals([]); setInhouse([]); setDepartures([]);
        setTotalRooms(0);
        setKpis(null);
        setAccessProblem(
          "We couldn’t open this property. You might not have access yet or the property doesn’t exist."
        );
        setLoading(false);
        return;
      }

      setHotel(hotelRow);

      // 2) Ops lists (non-blocking; if any fail, we still render dashboard)
      const hotelId = hotelRow.id;
      const nowIso = new Date().toISOString();

      try {
        const [{ data: arr }, { data: inh }, { data: dep }] = await Promise.all([
          supabase
            .from("stays")
            .select("id,guest_id,check_in_start,check_out_end,status,room")
            .eq("hotel_id", hotelId)
            .gte("check_in_start", today)
            .lt("check_in_start", nextDayISO(today))
            .order("check_in_start", { ascending: true }),
          supabase
            .from("stays")
            .select("id,guest_id,check_in_start,check_out_end,status,room")
            .eq("hotel_id", hotelId)
            .lte("check_in_start", nowIso)
            .gte("check_out_end", nowIso)
            .order("check_out_end", { ascending: true }),
          supabase
            .from("stays")
            .select("id,guest_id,check_in_start,check_out_end,status,room")
            .eq("hotel_id", hotelId)
            .gte("check_out_end", today)
            .lt("check_out_end", nextDayISO(today))
            .order("check_out_end", { ascending: true }),
        ]);

        if (!alive) return;
        setArrivals(arr || []);
        setInhouse(inh || []);
        setDepartures(dep || []);
      } catch (e) {
        console.warn("[OwnerDashboard] stays queries failed:", e);
        setArrivals([]); setInhouse([]); setDepartures([]);
      }

      // 3) Rooms count (non-blocking)
      try {
        const { data: rooms } = await supabase
          .from("rooms")
          .select("id")
          .eq("hotel_id", hotelId);
        if (!alive) return;
        setTotalRooms(rooms?.length || 0);
      } catch (e) {
        console.warn("[OwnerDashboard] rooms query failed:", e);
        setTotalRooms(0);
      }

      // 4) KPIs view (non-blocking). It’s OK if the view doesn’t exist yet.
      try {
        const { data: k } = await supabase
          .from("v_hotel_kpis_today")
          .select("*")
          .eq("hotel_id", hotelId)
          .maybeSingle();
        if (!alive) return;
        setKpis(k ?? null);
      } catch {
        setKpis(null);
      }

      // 5) (Optional) Edge Function demo toggle
      if (HAS_FUNCS) {
        // Invoke your functions here
      }

      setLoading(false);
    })();

    return () => { alive = false; };
  }, [slug, today]);

  /** ======= UI States ======= */
  if (loading) {
    return (
      <main className="min-h-[60vh] grid place-items-center">
        <Spinner label="Loading property dashboard…" />
      </main>
    );
  }

  if (accessProblem) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <BackHome />
        <AccessHelp
          slug={slug || ""}
          message={accessProblem}
          inviteToken={inviteToken || undefined}
        />
      </main>
    );
  }

  if (!hotel) {
    return (
      <main className="min-h-[60vh] grid place-items-center">
        <div className="rounded-xl border p-6 text-center">
          <div className="text-lg font-medium mb-2">No property to show</div>
          <p className="text-sm text-gray-600">
            Try opening your property dashboard from the Owner Home.
          </p>
          <div className="mt-4">
            <Link to="/owner" className="btn btn-light">Owner Home</Link>
          </div>
        </div>
      </main>
    );
  }

  /** ======= KPI Calculations (fallbacks if view absent) ======= */
  const total = kpis?.total_rooms ?? totalRooms;
  const inH = kpis?.inhouse ?? inhouse.length;
  const occPct = total ? Math.round((inH / total) * 100) : 0;

  const occupiedRoomsToday = kpis?.occupied_rooms_today ?? inH;
  const revenueToday = kpis?.room_revenue_today ?? 0;
  const adr = occupiedRoomsToday ? revenueToday / occupiedRoomsToday : 0;
  const revpar = total ? (adr * inH) / total : 0;

  const pickup7d = kpis?.pickup7d ?? 0; // when you add it

  /** ======= Render ======= */
  return (
    <main className="max-w-6xl mx-auto p-6">
      <BackHome />

      {/* Invite banner if token present */}
      {inviteToken ? (
        <div className="mb-4 rounded-2xl border p-4 bg-emerald-50">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">You have a pending invite</div>
              <div className="text-sm text-emerald-900">
                Accept the invitation to manage this property.
              </div>
            </div>
            <Link to={`/invite/accept?code=${encodeURIComponent(inviteToken)}`} className="btn">
              Accept Invite
            </Link>
          </div>
        </div>
      ) : null}

      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{hotel.name}</h1>
          {hotel.city ? <p className="text-sm text-gray-600">{hotel.city}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/owner/${hotel.slug}/ops`} className="btn btn-light">Operations</Link>
          <Link to={`/owner/${hotel.slug}/housekeeping`} className="btn btn-light">Housekeeping</Link>
          <Link to={`/owner/${hotel.slug}/settings`} className="btn btn-light">Settings</Link>
          <Link to={`/owner/access?slug=${encodeURIComponent(hotel.slug)}`} className="btn btn-light">Access</Link>
          <Link to={`/invite/accept`} className="btn btn-light">Accept Invite</Link>
        </div>
      </header>

      {/* ======= New KPI Row ======= */}
      <KpiRow
        items={[
          { label: "Occupancy", value: `${occPct}%`, sub: `${inH}/${total}`, trend: kpis?.occ_delta ?? null },
          { label: "ADR", value: `₹${adr.toFixed(0)}`, sub: "today", trend: kpis?.adr_delta ?? null },
          { label: "RevPAR", value: `₹${revpar.toFixed(0)}`, sub: "today", trend: kpis?.revpar_delta ?? null },
          { label: "Pick-up (7d)", value: pickup7d ?? 0, sub: "new nights", trend: null },
        ]}
      />

      {/* ======= Pricing nudge (owner-friendly) ======= */}
      <PricingNudge
        occupancy={occPct}
        suggestion={`Consider raising tonight’s base rate by ₹${suggestedBump(occPct)} to capture late demand.`}
        ctaTo={`/owner/${hotel.slug}/settings`}
      />

      {/* ======= Heatmap + Lists ======= */}
      <section className="grid gap-4 lg:grid-cols-3 mb-6">
        <div className="lg:col-span-2">
          <OccupancyHeatmap title="Occupancy (next 6 weeks)" />
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="font-medium mb-2">Housekeeping progress</div>
          <p className="text-sm text-gray-500">Hook this to your HK table next. For now this is a placeholder.</p>
          <div className="mt-4 h-2 rounded-full bg-gray-100">
            <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.min(occPct, 100)}%` }} />
          </div>
          <div className="text-xs text-gray-500 mt-2">{Math.min(occPct, 100)}% rooms ready</div>
        </div>
      </section>

      {/* ======= Lists (kept from your file) ======= */}
      <section className="grid gap-4 md:grid-cols-3">
        <Board title="Arrivals today" items={arrivals} empty="No arrivals today." />
        <Board title="In-house" items={inhouse} empty="No guests are currently in-house." />
        <Board title="Departures today" items={departures} empty="No departures today." />
      </section>
    </main>
  );
}

/** ========= Components ========= */

function KpiRow({
  items,
}: {
  items: { label: string; value: string | number; sub?: string; trend?: number | null }[];
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
      {items.map((k) => (
        <div key={k.label} className="rounded-xl border bg-white p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm text-gray-500">{k.label}</div>
              <div className="text-2xl font-semibold mt-1">{k.value}</div>
              {k.sub ? <div className="text-xs text-gray-500 mt-0.5">{k.sub}</div> : null}
            </div>
            <MiniSparkline />
          </div>
          {typeof k.trend === "number" ? (
            <div className={`mt-2 text-xs ${k.trend >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {k.trend >= 0 ? "▲" : "▼"} {Math.abs(k.trend)}% vs. prev
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function MiniSparkline() {
  // Simple CSS sparkline placeholder (no extra libs)
  return (
    <div className="ml-4 mt-1 h-8 w-20 relative">
      <div className="absolute inset-0 opacity-20 bg-gradient-to-tr from-emerald-500 to-indigo-500 rounded" />
      <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between px-1">
        {[4, 8, 3, 9, 6, 10, 7].map((h, i) => (
          <div key={i} className="w-1.5 rounded-t bg-emerald-500" style={{ height: `${h * 6}%` }} />
        ))}
      </div>
    </div>
  );
}

function PricingNudge({
  occupancy,
  suggestion,
  ctaTo,
}: {
  occupancy: number;
  suggestion: string;
  ctaTo: string;
}) {
  const tone = occupancy >= 80 ? "Great momentum!" : occupancy >= 40 ? "Room to grow." : "Let’s boost pick-up.";
  return (
    <section className="mb-6 rounded-2xl border bg-gradient-to-r from-amber-50 to-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-amber-800 font-medium">{tone}</div>
          <div className="text-gray-800 mt-1">{suggestion}</div>
          <div className="text-xs text-gray-500 mt-1">
            Tip: Auto-pricing can do this automatically and show you the uplift.
          </div>
        </div>
        <Link to={ctaTo} className="btn">Open pricing</Link>
      </div>
    </section>
  );
}

function OccupancyHeatmap({ title }: { title: string }) {
  // 6 weeks x 7 days skeleton grid (replace with real data later)
  const weeks = 6, days = 7;
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="font-medium mb-3">{title}</div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: weeks * days }).map((_, i) => (
          <div
            key={i}
            className="aspect-square rounded-md bg-gray-100"
            style={{ opacity: 0.6 + 0.4 * Math.sin((i % 7) / 7) }}
            title="Occupancy placeholder"
          />
        ))}
      </div>
      <div className="mt-3 text-xs text-gray-500">Deeper calendar with real data coming next.</div>
    </div>
  );
}

function Board({
  title,
  items,
  empty,
}: {
  title: string;
  items: StayRow[];
  empty: string;
}) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="font-medium mb-2">{title}</div>
      {items.length === 0 ? (
        <div className="text-sm text-gray-500">{empty}</div>
      ) : (
        <ul className="space-y-2">
          {items.map((s) => (
            <li key={s.id} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">
                    {s.room ? `Room ${s.room}` : "Unassigned room"}
                  </div>
                  <div className="text-gray-500 text-xs">
                    {fmt(s.check_in_start)} → {fmt(s.check_out_end)}
                  </div>
                </div>
                <div className="text-xs uppercase tracking-wide text-gray-600">
                  {s.status || "—"}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AccessHelp({
  slug,
  message,
  inviteToken,
}: {
  slug: string;
  message: string;
  inviteToken?: string;
}) {
  return (
    <div className="rounded-2xl border p-6 bg-amber-50">
      <div className="text-lg font-semibold mb-1">Property access needed</div>
      <p className="text-sm text-amber-900 mb-4">{message}</p>
      <div className="flex flex-wrap gap-2">
        {slug ? (
          <Link to={`/owner/access?slug=${encodeURIComponent(slug)}`} className="btn">Request Access</Link>
        ) : null}
        <Link to="/owner" className="btn btn-light">Owner Home</Link>
        <Link to="/invite/accept" className="btn btn-light">Accept Invite</Link>
        {inviteToken ? (
          <Link to={`/invite/accept?code=${encodeURIComponent(inviteToken)}`} className="btn btn-light">Accept via Code</Link>
        ) : null}
      </div>
      <p className="text-xs text-amber-900 mt-3">
        Tip: If you received an email invite, open it on this device so we can auto-fill your invite code.
      </p>
    </div>
  );
}

/** ========= Utils ========= */
function fmt(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString();
}
function nextDayISO(yyyy_mm_dd: string) {
  const d = new Date(yyyy_mm_dd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function suggestedBump(occ: number) {
  if (occ >= 90) return 1200;
  if (occ >= 75) return 800;
  if (occ >= 60) return 500;
  return 300;
}
