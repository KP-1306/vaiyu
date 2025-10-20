// web/src/routes/OwnerDashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Spinner from "../components/Spinner";
import BackHome from "../components/BackHome";

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
  guest_name?: string | null;
};

// Optional Edge Functions guard (keep false until you actually deploy them)
const HAS_FUNCS = import.meta.env.VITE_HAS_FUNCS === "true";

export default function OwnerDashboard() {
  const { slug } = useParams();
  const [params] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [hotel, setHotel] = useState<Hotel | null>(null);

  const [arrivals, setArrivals] = useState<StayRow[]>([]);
  const [inhouse, setInhouse] = useState<StayRow[]>([]);
  const [departures, setDepartures] = useState<StayRow[]>([]);

  // NEW: rooms + occupancy%
  const [totalRooms, setTotalRooms] = useState<number>(0);

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

      // 1) Hotel (RLS-gated). Only show "access needed" if this fails or returns null.
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
        setArrivals([]);
        setInhouse([]);
        setDepartures([]);
        setTotalRooms(0);
        setAccessProblem(
          "We couldn’t open this property. You might not have access yet or the property doesn’t exist."
        );
        setLoading(false);
        return;
      }

      setHotel(hotelRow);

      // 2) Ops lists (non-blocking: if any fail, we still render dashboard skeleton)
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
        setArrivals([]);
        setInhouse([]);
        setDepartures([]);
      }

      // 3) Rooms (non-blocking)
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

      // 4) (Optional) Edge Function widgets behind a flag
      if (HAS_FUNCS) {
        // Example:
        // try {
        //   const { data } = await supabase.functions.invoke("me-spend", { body: { years: 1 } });
        //   if (!alive) return;
        //   setSpend(data ?? []);
        // } catch { /* ignore */ }
      }

      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [slug, today]);

  // Loading
  if (loading) {
    return (
      <main className="min-h-[60vh] grid place-items-center">
        <Spinner label="Loading property dashboard…" />
      </main>
    );
  }

  // Access problem (hotel not readable / not found)
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

  // Occupancy using rooms + inhouse[]
  const occPct = totalRooms > 0 ? Math.round((inhouse.length / totalRooms) * 100) : 0;
  const kpCards = [
    { label: "Arrivals", value: arrivals.length },
    { label: "In-house", value: inhouse.length },
    { label: "Departures", value: departures.length },
    { label: "Occupancy", value: `${occPct}% (${inhouse.length}/${totalRooms})` },
  ];

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
            <Link
              to={`/invite/accept?code=${encodeURIComponent(inviteToken)}`}
              className="btn"
            >
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
          {/* OwnerAccess & InviteAccept entry points */}
          <Link
            to={`/owner/access?slug=${encodeURIComponent(hotel.slug)}`}
            className="btn btn-light"
          >
            Access
          </Link>
          <Link to={`/invite/accept`} className="btn btn-light">Accept Invite</Link>
        </div>
      </header>

      {/* KPI cards */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        {kpCards.map((k) => (
          <div key={k.label} className="rounded-xl border bg-white p-4">
            <div className="text-sm text-gray-500">{k.label}</div>
            <div className="text-2xl font-semibold mt-1">{k.value}</div>
          </div>
        ))}
      </section>

      {/* Lists */}
      <section className="grid gap-4 md:grid-cols-3">
        <Board title="Arrivals today" items={arrivals} empty="No arrivals today." />
        <Board title="In-house" items={inhouse} empty="No guests are currently in-house." />
        <Board title="Departures today" items={departures} empty="No departures today." />
      </section>
    </main>
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
          <Link
            to={`/owner/access?slug=${encodeURIComponent(slug)}`}
            className="btn"
          >
            Request Access
          </Link>
        ) : null}
        <Link to="/owner" className="btn btn-light">Owner Home</Link>
        <Link to="/invite/accept" className="btn btn-light">Accept Invite</Link>
        {inviteToken ? (
          <Link
            to={`/invite/accept?code=${encodeURIComponent(inviteToken)}`}
            className="btn btn-light"
          >
            Accept via Code
          </Link>
        ) : null}
      </div>
      <p className="text-xs text-amber-900 mt-3">
        Tip: If you received an email invite, open it on this device so we can auto-fill your invite code.
      </p>
    </div>
  );
}

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
