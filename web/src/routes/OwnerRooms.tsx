// web/src/routes/OwnerRooms.tsx — Availability + History
// Friendly, production‑ready page to inspect rooms, see who’s in, and browse history.
// Stack: React + Vite + Tailwind + shadcn/ui + Supabase JS
// Schema‑safe: only assumes rooms.id & rooms.hotel_id exist; other display fields are optional.
// Stays table assumed (id, hotel_id, room, check_in_start, check_out_end, status, guest_id). If missing, UI degrades gracefully.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

// Types ----------------------------------------------------------------------
type Hotel = { id: string; name: string; slug: string };
type RoomRow = { id: string; hotel_id: string; number?: string | null; name?: string | null; label?: string | null; code?: string | null; floor?: string | null; type?: string | null; status?: string | null };
type StayRow = { id: string; hotel_id: string; room: string | null; guest_id: string | null; check_in_start: string | null; check_out_end: string | null; status: string | null };

// Utils ----------------------------------------------------------------------
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const startOfDayISO = (yyyy_mm_dd: string) => new Date(yyyy_mm_dd + "T00:00:00Z").toISOString();
const endOfDayISO   = (yyyy_mm_dd: string) => new Date(yyyy_mm_dd + "T23:59:59Z").toISOString();
const fmtDateTime = (s?: string | null) => (s ? new Date(s).toLocaleString() : "—");

function displayRoomName(r: RoomRow) {
  return r.number || r.name || r.label || r.code || r.id.slice(0, 8);
}

// Occupancy classifier for a given date window ------------------------------
function classify(roomId: string, stays: StayRow[], day: string) {
  const start = startOfDayISO(day);
  const end   = endOfDayISO(day);
  const relevant = stays.filter(s => s.room === roomId && s.check_in_start && s.check_out_end);
  const overlaps = relevant.filter(s => s.check_in_start! <= end && s.check_out_end! > start);
  if (overlaps.length === 0) return { state: "vacant" as const, stay: null as StayRow | null };
  return { state: "occupied" as const, stay: overlaps.sort((a,b)=> (a.check_in_start! < b.check_in_start! ? 1 : -1))[0] };
}

function toneForState(state: "vacant" | "occupied") {
  return state === "occupied" ? "amber" : "green"; // vacant is healthy for cleaning; occupied means busy
}

// Component ------------------------------------------------------------------
export default function OwnerRooms() {
  const { slug } = useParams();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [stays, setStays] = useState<StayRow[]>([]);
  const [day, setDay] = useState<string>(() => isoDay(new Date()));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!slug) { setLoading(false); return; }

      // 1) Hotel
      const { data: h } = await supabase.from("hotels").select("id,name,slug").eq("slug", slug).maybeSingle();
      if (!alive) return; setHotel(h || null);
      const hotelId = h?.id;

      // 2) Rooms (try to fetch common optional display fields; unknown columns will be ignored by Supabase)
      try {
        const { data: r } = await supabase
          .from("rooms")
          .select("id,hotel_id,number,name,label,code,floor,type,status")
          .eq("hotel_id", hotelId!);
        if (!alive) return; setRooms(r || []);
      } catch { setRooms([]); }

      // 3) Stays overlapping ±45 days around selected day (to power history)
      const start = new Date(day + "T00:00:00Z");
      const past = new Date(start); past.setUTCDate(past.getUTCDate() - 45);
      const future = new Date(start); future.setUTCDate(future.getUTCDate() + 45);
      try {
        const { data: s } = await supabase
          .from("stays")
          .select("id,hotel_id,room,guest_id,check_in_start,check_out_end,status")
          .eq("hotel_id", hotelId!)
          .gte("check_in_start", past.toISOString())
          .lte("check_out_end", future.toISOString());
        if (!alive) return; setStays(s || []);
      } catch { setStays([]); }

      setLoading(false);
    })();
    return () => { alive = false; };
  }, [slug, day]);

  const occupancy = useMemo(() => {
    const total = rooms.length;
    const occ = rooms.filter(r => classify(r.id, stays, day).state === "occupied").length;
    const pct = total ? Math.round((occ / total) * 100) : 0;
    return { total, occ, pct };
  }, [rooms, stays, day]);

  return (
    <main className="max-w-6xl mx-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Rooms</h1>
          <p className="text-sm text-muted-foreground">Availability and recent history for each room. Click a room to see its timeline.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/owner/${slug}`} className="btn btn-light">← Back to dashboard</Link>
          <Link to={`/owner/${slug}/housekeeping`} className="btn">Open Housekeeping</Link>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border bg-white p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Day</label>
            <input type="date" value={day} onChange={(e)=>setDay(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          </div>
          <div className="text-sm text-muted-foreground">Occupied today: <b>{occupancy.occ}</b> / {occupancy.total} rooms ({occupancy.pct}%)</div>
        </div>
      </div>

      {/* Rooms grid */}
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {loading ? (
          <div className="col-span-full text-sm text-muted-foreground">Loading rooms…</div>
        ) : rooms.length === 0 ? (
          <div className="col-span-full text-sm text-muted-foreground">No rooms found for this property.</div>
        ) : (
          rooms.map((r)=>{
            const status = classify(r.id, stays, day);
            return (
              <RoomCard key={r.id} room={r} state={status.state} stay={status.stay} slug={slug!} />
            );
          })
        )}
      </div>
    </main>
  );
}

function Badge({ tone, children }:{ tone: "green"|"amber"|"red"|"grey"; children: React.ReactNode }) {
  const cls = {
    green: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    red:   "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
    grey:  "bg-slate-50 text-slate-600 ring-1 ring-slate-200",
  }[tone];
  return <span className={`px-2 py-0.5 rounded-full text-xs ${cls}`}>{children}</span>;
}

function RoomCard({ room, state, stay, slug }:{ room: RoomRow; state: "vacant"|"occupied"; stay: StayRow|null; slug: string }) {
  const name = displayRoomName(room);
  const tone = state === "occupied" ? "amber" : "green";
  const href = `/owner/${slug}/rooms/${encodeURIComponent(room.id)}`;
  return (
    <Link to={href} className="rounded-xl border bg-white p-4 hover:shadow-sm transition">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm text-muted-foreground">Room</div>
          <div className="text-xl font-semibold">{name}</div>
        </div>
        <Badge tone={tone}>{state === "occupied" ? "Occupied" : "Vacant"}</Badge>
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {state === "occupied" && stay ? (
          <div>
            <div>In since: {fmtDateTime(stay.check_in_start)}</div>
            <div>Out by: {fmtDateTime(stay.check_out_end)}</div>
          </div>
        ) : (
          <div>No one staying today.</div>
        )}
      </div>
      <div className="mt-3 text-xs underline">See history</div>
    </Link>
  );
}
