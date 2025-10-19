import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
  guest_name?: string | null; // optional if you have joined view
};

export default function OwnerDashboard() {
  const { slug } = useParams();
  const [loading, setLoading] = useState(true);
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [arrivals, setArrivals] = useState<StayRow[]>([]);
  const [inhouse, setInhouse] = useState<StayRow[]>([]);
  const [departures, setDepartures] = useState<StayRow[]>([]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    (async () => {
      setLoading(true);

      // 1) Get the hotel by slug (RLS will ensure membership)
      const { data: hotelRows, error: hErr } = await supabase
        .from("hotels")
        .select("id,name,slug,city")
        .eq("slug", slug)
        .limit(1)
        .maybeSingle();

      if (hErr || !hotelRows) {
        console.error(hErr);
        setHotel(null);
        setLoading(false);
        return;
      }
      if (!alive) return;

      setHotel(hotelRows);

      // 2) Fetch ops lists – small client-side filters for MVP
      const hotelId = hotelRows.id;

      // Arrivals today: check_in_start::date = today
      const { data: arr, error: aErr } = await supabase
        .from("stays")
        .select("id,guest_id,check_in_start,check_out_end,status,room")
        .eq("hotel_id", hotelId)
        .gte("check_in_start", today)
        .lt("check_in_start", nextDayISO(today))
        .order("check_in_start", { ascending: true });

      // In-house: now overlaps the stay window
      const nowIso = new Date().toISOString();
      const { data: inh, error: iErr } = await supabase
        .from("stays")
        .select("id,guest_id,check_in_start,check_out_end,status,room")
        .eq("hotel_id", hotelId)
        .lte("check_in_start", nowIso)
        .gte("check_out_end", nowIso)
        .order("check_out_end", { ascending: true });

      // Departures today: check_out_end::date = today
      const { data: dep, error: dErr } = await supabase
        .from("stays")
        .select("id,guest_id,check_in_start,check_out_end,status,room")
        .eq("hotel_id", hotelId)
        .gte("check_out_end", today)
        .lt("check_out_end", nextDayISO(today))
        .order("check_out_end", { ascending: true });

      if (!alive) return;

      if (aErr) console.error(aErr);
      if (iErr) console.error(iErr);
      if (dErr) console.error(dErr);

      setArrivals(arr || []);
      setInhouse(inh || []);
      setDepartures(dep || []);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [slug, today]);

  if (loading || !hotel) {
    return (
      <main className="min-h-[60vh] grid place-items-center">
        <Spinner label="Loading property dashboard…" />
      </main>
    );
  }

  const occ = inhouse.length; // MVP – later compute vs total rooms
  const kpCards = [
    { label: "Arrivals", value: arrivals.length },
    { label: "In-house", value: inhouse.length },
    { label: "Departures", value: departures.length },
    { label: "Occupancy (rooms)", value: occ },
  ];

  return (
    <main className="max-w-6xl mx-auto p-6">
      <BackHome />
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{hotel.name}</h1>
          <p className="text-sm text-gray-600">Today at a glance — {hotel.city || "—"}</p>
        </div>
        <div className="flex gap-2">
          <Link to={`/owner/${hotel.slug}/ops`} className="btn btn-light">Operations</Link>
          <Link to={`/owner/${hotel.slug}/housekeeping`} className="btn btn-light">Housekeeping</Link>
          <Link to={`/owner/${hotel.slug}/settings`} className="btn btn-light">Settings</Link>
        </div>
      </header>

      {/* KPIs */}
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

function Board({ title, items, empty }:{
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
                  <div className="font-medium">{s.room ? `Room ${s.room}` : "Unassigned room"}</div>
                  <div className="text-gray-500 text-xs">
                    {fmt(s.check_in_start)} → {fmt(s.check_out_end)}
                  </div>
                </div>
                <div className="text-xs uppercase tracking-wide text-gray-600">{s.status || "—"}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
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
