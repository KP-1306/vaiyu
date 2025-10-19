// web/src/routes/OwnerHousekeeping.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import BackHome from "../components/BackHome";
import Spinner from "../components/Spinner";

type Hotel = {
  id: string;
  slug: string;
  name: string | null;
  city?: string | null;
};

type Room = {
  id: string;
  hotel_id: string;
  number: string;
  floor: string | null;
  type: string | null;
  status: "vacant" | "occupied" | "ooo" | string; // tolerant to unknown
  created_at?: string;
};

export default function OwnerHousekeeping() {
  const { slug } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "vacant" | "occupied" | "ooo">("all");
  const [floor, setFloor] = useState<string>("all");
  const [rtype, setRtype] = useState<string>("all");

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!slug) {
        setError("Missing property slug in the URL.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      // 1) Get hotel (RLS-gated)
      const { data: h, error: hErr } = await supabase
        .from("hotels")
        .select("id,slug,name,city")
        .eq("slug", slug)
        .limit(1)
        .maybeSingle();

      if (!alive) return;

      if (hErr || !h) {
        setHotel(null);
        setRooms([]);
        setError("We couldn’t open this property. You might not have access yet or it doesn’t exist.");
        setLoading(false);
        return;
      }

      setHotel(h);

      // 2) Fetch rooms for hotel
      const { data: r, error: rErr } = await supabase
        .from("rooms")
        .select("id,hotel_id,number,floor,type,status,created_at")
        .eq("hotel_id", h.id)
        .order("floor", { ascending: true, nullsFirst: true })
        .order("number", { ascending: true });

      if (!alive) return;

      if (rErr) {
        setRooms([]);
        setError(rErr.message);
      } else {
        setRooms((r || []) as Room[]);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [slug]);

  const floors = useMemo(() => {
    const set = new Set<string>();
    rooms.forEach((r) => r.floor && set.add(r.floor));
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [rooms]);

  const types = useMemo(() => {
    const set = new Set<string>();
    rooms.forEach((r) => r.type && set.add(r.type));
    return Array.from(set).sort();
  }, [rooms]);

  const counts = useMemo(() => {
    const c = { total: rooms.length, vacant: 0, occupied: 0, ooo: 0 };
    rooms.forEach((r) => {
      const s = (r.status || "").toLowerCase();
      if (s === "vacant") c.vacant++;
      else if (s === "occupied") c.occupied++;
      else if (s === "ooo") c.ooo++;
    });
    return c;
  }, [rooms]);

  const filtered = useMemo(() => {
    const qn = q.trim().toLowerCase();
    return rooms.filter((r) => {
      if (status !== "all" && (r.status || "").toLowerCase() !== status) return false;
      if (floor !== "all" && (r.floor || "") !== floor) return false;
      if (rtype !== "all" && (r.type || "") !== rtype) return false;
      if (qn && !(`${r.number}`.toLowerCase().includes(qn))) return false;
      return true;
    });
  }, [rooms, q, status, floor, rtype]);

  if (loading) {
    return (
      <main className="min-h-[60vh] grid place-items-center">
        <Spinner label="Loading housekeeping…" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <BackHome />
        <div className="rounded-xl border p-6 bg-rose-50 text-rose-900">
          <div className="font-semibold mb-1">Can’t load Housekeeping</div>
          <div className="text-sm">{error}</div>
          <div className="mt-4">
            <Link to="/owner" className="btn btn-light">Owner Home</Link>
          </div>
        </div>
      </main>
    );
  }

  if (!hotel) {
    return (
      <main className="min-h-[60vh] grid place-items-center">
        <div className="rounded-xl border p-6 text-center">
          <div className="text-lg font-medium mb-2">No property to show</div>
          <p className="text-sm text-gray-600">Open this page from your Owner Dashboard.</p>
          <div className="mt-4">
            <Link to="/owner" className="btn btn-light">Owner Home</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto p-6">
      <BackHome />

      <header className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            Housekeeping · {hotel.name || hotel.slug}
          </h1>
          <p className="text-sm text-gray-500">Read-only scaffold · status overview and quick filters</p>
        </div>
        <div className="flex gap-2">
          <Link to={`/owner/${hotel.slug}/dashboard`} className="btn btn-light">Dashboard</Link>
          <Link to={`/owner/${hotel.slug}/settings`} className="btn btn-light">Settings</Link>
        </div>
      </header>

      {/* Summary cards */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Kpi label="Total Rooms" value={counts.total} />
        <Kpi label="Vacant" value={counts.vacant} badge="vacant" />
        <Kpi label="Occupied" value={counts.occupied} badge="occupied" />
        <Kpi label="Out of Order" value={counts.ooo} badge="ooo" />
      </section>

      {/* Filters */}
      <section className="rounded-2xl border p-4 mb-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="col-span-1">
            <label className="block text-xs text-gray-500 mb-1">Search room #</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="e.g., 101"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
              className="w-full rounded-xl border px-3 py-2"
            >
              <option value="all">All</option>
              <option value="vacant">Vacant</option>
              <option value="occupied">Occupied</option>
              <option value="ooo">Out of Order</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Floor</label>
            <select
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              className="w-full rounded-xl border px-3 py-2"
            >
              <option value="all">All</option>
              {floors.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Type</label>
            <select
              value={rtype}
              onChange={(e) => setRtype(e.target.value)}
              className="w-full rounded-xl border px-3 py-2"
            >
              <option value="all">All</option>
              {types.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Rooms table (cards on mobile) */}
      <section className="rounded-2xl border overflow-hidden">
        <div className="hidden md:grid grid-cols-6 gap-2 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-600">
          <div>Room #</div>
          <div>Status</div>
          <div>Floor</div>
          <div>Type</div>
          <div>Created</div>
          <div className="text-right">Actions</div>
        </div>
        <ul className="divide-y">
          {filtered.length === 0 ? (
            <li className="p-4 text-sm text-gray-500">No rooms match your filters.</li>
          ) : (
            filtered.map((r) => (
              <li key={r.id} className="p-4 grid grid-cols-1 md:grid-cols-6 gap-2 items-center">
                <div className="font-medium">#{r.number}</div>
                <div>
                  <StatusBadge status={(r.status || "").toLowerCase()} />
                </div>
                <div className="text-sm text-gray-600">{r.floor || "—"}</div>
                <div className="text-sm text-gray-600">{r.type || "—"}</div>
                <div className="text-xs text-gray-500">{r.created_at ? fmt(r.created_at) : "—"}</div>
                <div className="md:text-right">
                  <span className="text-xs text-gray-400">Read-only</span>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>

      <p className="text-xs text-gray-500 mt-3">
        Tip: This is a read-only scaffold. When you’re ready, we can add actions to mark rooms
        clean/dirty, change status, or batch update by floor/type — gated by your RLS write policies.
      </p>
    </main>
  );
}

function Kpi({ label, value, badge }: { label: string; value: number; badge?: "vacant" | "occupied" | "ooo" }) {
  return (
    <div className="rounded-2xl border p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <div className="text-2xl font-semibold">{value}</div>
        {badge ? <StatusBadge status={badge} compact /> : null}
      </div>
    </div>
  );
}

function StatusBadge({ status, compact }: { status: string; compact?: boolean }) {
  const label = status === "ooo" ? "Out of Order" : capitalize(status || "unknown");
  const base = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs";
  const cls =
    status === "occupied"
      ? "border-gray-900 text-gray-900"
      : status === "vacant"
      ? "border-emerald-600 text-emerald-700"
      : status === "ooo"
      ? "border-rose-600 text-rose-700"
      : "border-gray-300 text-gray-500";
  return <span className={`${base} ${cls} ${compact ? "" : "uppercase tracking-wide"}`}>{label}</span>;
}

function capitalize(s: string) {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
function fmt(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}
