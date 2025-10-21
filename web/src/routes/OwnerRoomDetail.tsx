// web/src/routes/OwnerRoomDetail.tsx — room timeline + filters + contacts + inline notes + heatmap + export + bulk blocks + rate history + HK tasks
// Enhancements added:
// • Filters: date range + status filter for stays
// • Guest contact/actions: tel/mailto when available
// • Inline housekeeping note add (best‑effort insert)
// • Calendar heatmap (6 weeks) of this room’s occupancy
// • Bulk actions: block / unblock dates for the room (best‑effort table: room_blocks)
// • Rate plan history: pulls from pricing_history (best‑effort) or shows empty‑state
// • Housekeeping tasks inline: list + status toggle (best‑effort table: housekeeping_tasks)
// • CSV export of filtered stays
// Safe against missing columns; optional fields are rendered only when present.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

// ------------------------------- Types --------------------------------------
type Hotel = { id: string; name: string; slug: string };
type Room = { id: string; hotel_id: string; number?: string | null; name?: string | null; label?: string | null; code?: string | null; floor?: string | null; type?: string | null; status?: string | null };
type Stay = { id: string; hotel_id: string; room: string | null; guest_id: string | null; check_in_start: string | null; check_out_end: string | null; status: string | null };
type Guest = { id: string; full_name?: string | null; phone?: string | null; email?: string | null };
type HkNote = { id: string; room_id: string; created_at: string; note: string; author?: string | null; status?: string | null };
type HkTask = { id: string; room_id: string; title: string; status: string; created_at: string };
type BlockRow = { id: string; room_id: string; start_date: string; end_date: string; reason?: string | null; created_at?: string };
type RateRow = { id: string; room_id: string; date: string; rate: number; source?: string | null; created_at?: string };

// ------------------------------- Utils --------------------------------------
const iso = (d: Date) => d.toISOString();
const fmtDT = (s?: string | null) => (s ? new Date(s).toLocaleString() : "—");
const displayRoomName = (r: Room) => r.number || r.name || r.label || r.code || r.id.slice(0, 8);

function csvEscape(v: any) { if (v == null) return ""; const s = String(v).replaceAll('"', '""'); return `"${s}"`; }
function downloadCSV(filename: string, rows: any[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvEscape).join(",")];
  for (const r of rows) lines.push(headers.map(h => csvEscape((r as any)[h])).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

// Heatmap helpers -------------------------------------------------------------
function daysArray(start: Date, count: number) { return Array.from({ length: count }, (_, i) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); return d; }); }
function sameDay(a: Date, b: Date) { return a.getUTCFullYear()===b.getUTCFullYear() && a.getUTCMonth()===b.getUTCMonth() && a.getUTCDate()===b.getUTCDate(); }
function overlapsDay(stay: Stay, day: Date) {
  if (!stay.check_in_start || !stay.check_out_end) return false;
  const start = new Date(day); start.setUTCHours(0,0,0,0);
  const end   = new Date(day); end.setUTCHours(23,59,59,999);
  const a = new Date(stay.check_in_start).getTime();
  const b = new Date(stay.check_out_end).getTime();
  return a <= end.getTime() && b > start.getTime();
}

function badgeTone(t: "green" | "amber" | "red" | "grey") {
  return { green: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
           amber: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
           red:   "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
           grey:  "bg-slate-50 text-slate-600 ring-1 ring-slate-200"}[t];
}

// ------------------------------- Component ----------------------------------
export default function OwnerRoomDetail() {
  const { slug, roomId } = useParams();
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [stays, setStays] = useState<Stay[]>([]);
  const [guestsById, setGuestsById] = useState<Record<string, Guest>>({});
  const [hkNotes, setHkNotes] = useState<HkNote[]>([]);
  const [hkTasks, setHkTasks] = useState<HkTask[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [rates, setRates] = useState<RateRow[]>([]);

  // Filters
  const [fromDay, setFromDay] = useState<string>(() => new Date(Date.now() - 1000*60*60*24*30).toISOString().slice(0,10));
  const [toDay, setToDay] = useState<string>(() => new Date(Date.now() + 1000*60*60*24*30).toISOString().slice(0,10));
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Inline note
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  // Block form
  const [blockFrom, setBlockFrom] = useState<string>(() => new Date().toISOString().slice(0,10));
  const [blockTo, setBlockTo] = useState<string>(() => new Date(Date.now()+86400000).toISOString().slice(0,10));
  const [blockReason, setBlockReason] = useState<string>("");
  const [blockBusy, setBlockBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!slug || !roomId) { setLoading(false); return; }

      // 1) Hotel
      const { data: h } = await supabase.from("hotels").select("id,name,slug").eq("slug", slug).maybeSingle();
      if (!alive) return; setHotel(h || null);
      const hotelId = h?.id;

      // 2) Room record
      const { data: r } = await supabase
        .from("rooms")
        .select("id,hotel_id,number,name,label,code,floor,type,status")
        .eq("hotel_id", hotelId!)
        .eq("id", roomId!)
        .maybeSingle();
      if (!alive) return; setRoom(r || null);

      // 3) Stays within filter window
      const startISO = new Date(fromDay + "T00:00:00Z").toISOString();
      const endISO   = new Date(toDay + "T23:59:59Z").toISOString();
      const { data: s } = await supabase
        .from("stays")
        .select("id,hotel_id,room,guest_id,check_in_start,check_out_end,status")
        .eq("hotel_id", hotelId!)
        .eq("room", roomId!)
        .gte("check_in_start", startISO)
        .lte("check_out_end", endISO)
        .order("check_in_start", { ascending: false });
      if (!alive) return; setStays(s || []);

      // 4) Guests (best‑effort)
      const guestIds = Array.from(new Set((s||[]).map(x => x.guest_id).filter(Boolean))) as string[];
      if (guestIds.length) {
        const { data: gs } = await supabase
          .from("guests")
          .select("id,full_name,phone,email")
          .in("id", guestIds);
        if (!alive) return;
        const map: Record<string, Guest> = {};
        for (const g of gs || []) map[g.id] = g;
        setGuestsById(map);
      } else {
        setGuestsById({});
      }

      // 5) Housekeeping notes (optional table)
      try {
        const { data: notes } = await supabase
          .from("housekeeping_notes")
          .select("id,room_id,created_at,note,author,status")
          .eq("room_id", roomId!)
          .order("created_at", { ascending: false })
          .limit(50);
        if (!alive) return; setHkNotes(notes || []);
      } catch { setHkNotes([]); }

      // 6) HK tasks (optional table)
      try {
        const { data: tasks } = await supabase
          .from("housekeeping_tasks")
          .select("id,room_id,title,status,created_at")
          .eq("room_id", roomId!)
          .order("created_at", { ascending: false })
          .limit(50);
        if (!alive) return; setHkTasks(tasks || []);
      } catch { setHkTasks([]); }

      // 7) Blocks (optional table)
      try {
        const { data: rows } = await supabase
          .from("room_blocks")
          .select("id,room_id,start_date,end_date,reason,created_at")
          .eq("room_id", roomId!)
          .order("start_date", { ascending: false })
          .limit(50);
        if (!alive) return; setBlocks(rows || []);
      } catch { setBlocks([]); }

      // 8) Rate plan history (optional table)
      try {
        const { data: ratesRows } = await supabase
          .from("pricing_history")
          .select("id,room_id,date,rate,source,created_at")
          .eq("room_id", roomId!)
          .order("date", { ascending: false })
          .limit(90);
        if (!alive) return; setRates(ratesRows || []);
      } catch { setRates([]); }

      setLoading(false);
    })();
    return () => { alive = false; };
  }, [slug, roomId, fromDay, toDay]);

  const filteredStays = useMemo(() => {
    if (statusFilter === "all") return stays;
    return stays.filter(s => (s.status || "").toLowerCase() === statusFilter);
  }, [stays, statusFilter]);

  const csvRows = useMemo(() => {
    return (filteredStays || []).map(s => ({
      stay_id: s.id,
      check_in: s.check_in_start || "",
      check_out: s.check_out_end || "",
      status: s.status || "",
      guest: guestsById[s.guest_id || ""]?.full_name || s.guest_id || "",
    }));
  }, [filteredStays, guestsById]);

  // Heatmap (6 weeks from fromDay)
  const heatmapDays = useMemo(() => {
    const start = new Date(fromDay + "T00:00:00Z");
    return daysArray(start, 42); // 6 weeks * 7
  }, [fromDay]);

  const today = new Date();

  async function addNote() {
    if (!noteText.trim()) return;
    try {
      setNoteSaving(true);
      const { data, error } = await supabase
        .from("housekeeping_notes")
        .insert({ room_id: roomId, note: noteText })
        .select("id,room_id,created_at,note,author,status")
        .single();
      if (!error && data) {
        setHkNotes([data, ...hkNotes]);
        setNoteText("");
      }
    } finally { setNoteSaving(false); }
  }

  async function toggleTask(id: string, next: string) {
    try {
      const { data } = await supabase
        .from("housekeeping_tasks")
        .update({ status: next })
        .eq("id", id)
        .select("id,room_id,title,status,created_at")
        .single();
      if (data) setHkTasks(prev => prev.map(t => t.id === id ? data : t));
    } catch {}
  }

  async function addBlock() {
    if (!blockFrom || !blockTo) return;
    try {
      setBlockBusy(true);
      const { data } = await supabase
        .from("room_blocks")
        .insert({ room_id: roomId, start_date: blockFrom, end_date: blockTo, reason: blockReason || null })
        .select("id,room_id,start_date,end_date,reason,created_at")
        .single();
      if (data) setBlocks(prev => [data, ...prev]);
      setBlockReason("");
    } finally { setBlockBusy(false); }
  }

  async function removeBlock(id: string) {
    try {
      const { error } = await supabase.from("room_blocks").delete().eq("id", id);
      if (!error) setBlocks(prev => prev.filter(b => b.id !== id));
    } catch {}
  }

  return (
    <main className="max-w-6xl mx-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Room {room ? displayRoomName(room) : (roomId || "")}</h1>
          <p className="text-sm text-muted-foreground">Timeline of stays, guest info, blocks, and housekeeping for this room.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-light" onClick={() => nav(-1)}>← Back</button>
          <Link to={`/owner/${slug}/housekeeping`} className="btn">Open Housekeeping</Link>
          <button className="btn btn-light" onClick={() => downloadCSV(`room-${roomId}-stays.csv`, csvRows)}>Export CSV</button>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border bg-white p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">From</label>
            <input type="date" value={fromDay} onChange={(e)=>setFromDay(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">To</label>
            <input type="date" value={toDay} onChange={(e)=>setToDay(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Status</label>
            <select className="border rounded px-2 py-1 text-sm" value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="booked">booked</option>
              <option value="checked_in">checked_in</option>
              <option value="checked_out">checked_out</option>
              <option value="cancelled">cancelled</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading room details…</div>
      ) : !room ? (
        <div className="rounded-xl border p-4 bg-rose-50 text-rose-900 text-sm">We couldn’t find this room. It may have been removed or you don’t have access.</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Timeline */}
          <div className="lg:col-span-2 rounded-xl border bg-white p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-lg font-semibold">Stay timeline</h2>
                <p className="text-sm text-muted-foreground">Scroll through past and upcoming stays. Today is highlighted.</p>
              </div>
            </div>
            {filteredStays.length === 0 ? (
              <div className="text-sm text-muted-foreground">No stays recorded for this room in the selected window.</div>
            ) : (
              <ul className="space-y-3">
                {filteredStays.map((s) => (
                  <li key={s.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">{guestsById[s.guest_id || ""]?.full_name || `Guest ${s.guest_id?.slice(0,8) || "—"}`}</div>
                        <div className="text-xs text-muted-foreground">{fmtDT(s.check_in_start)} → {fmtDT(s.check_out_end)}</div>
                        {s.status && <div className="text-xs mt-1">Status: <span className="uppercase tracking-wide text-muted-foreground">{s.status}</span></div>}
                        {/* Guest actions */}
                        <div className="flex gap-2 mt-1 text-xs">
                          {guestsById[s.guest_id || ""]?.phone && (
                            <a className="underline" href={`tel:${guestsById[s.guest_id || ""].phone}`}>Call</a>
                          )}
                          {guestsById[s.guest_id || ""]?.email && (
                            <a className="underline" href={`mailto:${guestsById[s.guest_id || ""].email}`}>Email</a>
                          )}
                        </div>
                      </div>
                      <div className={`px-2 py-0.5 rounded-full text-xs ${badgeTone(overlapsDay(s, today) ? "amber" : "grey")}`}>
                        {overlapsDay(s, today) ? "Staying today" : "Past/Future"}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Right column: HK notes, Blocks, Tasks, Rate history */}
          <div className="space-y-4">
            {/* Housekeeping notes */}
            <div className="rounded-xl border bg-white p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h2 className="text-lg font-semibold">Housekeeping notes</h2>
                  <p className="text-sm text-muted-foreground">Quick issues, damages, or guest preferences kept by staff.</p>
                </div>
                <Link to={`/owner/${slug}/housekeeping`} className="text-sm underline">Open HK</Link>
              </div>
              {/* Add note inline */}
              <div className="mb-3">
                <textarea className="w-full border rounded p-2 text-sm" placeholder="Add a quick note (visible to staff)" value={noteText} onChange={(e)=>setNoteText(e.target.value)} rows={3} />
                <div className="mt-2 flex gap-2">
                  <button className="btn" onClick={addNote} disabled={noteSaving || !noteText.trim()}>{noteSaving ? "Saving…" : "Add note"}</button>
                  <button className="btn btn-light" onClick={()=>setNoteText("")}>Clear</button>
                </div>
              </div>
              {hkNotes.length === 0 ? (
                <div className="text-sm text-muted-foreground">No notes yet for this room.</div>
              ) : (
                <ul className="space-y-2">
                  {hkNotes.map(n => (
                    <li key={n.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{n.author || "Staff"}</div>
                        <div className="text-xs text-muted-foreground">{fmtDT(n.created_at)}</div>
                      </div>
                      <div className="mt-1">{n.note}</div>
                      {n.status && <div className="text-xs text-muted-foreground mt-1">Status: {n.status}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Blocks */}
            <div className="rounded-xl border bg-white p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h2 className="text-lg font-semibold">Blocks</h2>
                  <p className="text-sm text-muted-foreground">Block this room for maintenance or internal use.</p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div>
                  <label className="block text-xs mb-1 text-muted-foreground">From</label>
                  <input type="date" value={blockFrom} onChange={(e)=>setBlockFrom(e.target.value)} className="border rounded px-2 py-1 text-sm w-full" />
                </div>
                <div>
                  <label className="block text-xs mb-1 text-muted-foreground">To</label>
                  <input type="date" value={blockTo} onChange={(e)=>setBlockTo(e.target.value)} className="border rounded px-2 py-1 text-sm w-full" />
                </div>
                <div>
                  <label className="block text-xs mb-1 text-muted-foreground">Reason (optional)</label>
                  <input value={blockReason} onChange={(e)=>setBlockReason(e.target.value)} className="border rounded px-2 py-1 text-sm w-full" placeholder="Maintenance, VIP hold…" />
                </div>
              </div>
              <div className="mt-2">
                <button className="btn" onClick={addBlock} disabled={blockBusy}>Block dates</button>
              </div>
              <div className="mt-3">
                {blocks.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No blocks yet.</div>
                ) : (
                  <ul className="space-y-2">
                    {blocks.map(b => (
                      <li key={b.id} className="rounded-lg border p-3 text-sm flex items-center justify-between">
                        <div>{b.start_date} → {b.end_date}{b.reason ? ` · ${b.reason}` : ""}</div>
                        <button className="text-xs underline" onClick={()=>removeBlock(b.id)}>Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* HK tasks */}
            <div className="rounded-xl border bg-white p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h2 className="text-lg font-semibold">Housekeeping tasks</h2>
                  <p className="text-sm text-muted-foreground">Task list for this room — toggle to done when complete.</p>
                </div>
              </div>
              {hkTasks.length === 0 ? (
                <div className="text-sm text-muted-foreground">No tasks yet.</div>
              ) : (
                <ul className="space-y-2">
                  {hkTasks.map(t => (
                    <li key={t.id} className="rounded-lg border p-3 text-sm flex items-center justify-between">
                      <div>
                        <div className="font-medium">{t.title}</div>
                        <div className="text-xs text-muted-foreground">{fmtDT(t.created_at)}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${badgeTone(t.status === 'done' ? 'green' : 'amber')}`}>{t.status}</span>
                        {t.status !== 'done' ? (
                          <button className="text-xs underline" onClick={()=>toggleTask(t.id, 'done')}>Mark done</button>
                        ) : (
                          <button className="text-xs underline" onClick={()=>toggleTask(t.id, 'todo')}>Reopen</button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Rate plan history */}
            <div className="rounded-xl border bg-white p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h2 className="text-lg font-semibold">Rate plan history</h2>
                  <p className="text-sm text-muted-foreground">Recent price overrides for this room.</p>
                </div>
              </div>
              {rates.length === 0 ? (
                <div className="text-sm text-muted-foreground">No rate changes found for this room.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="text-sm w-full">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-3">Date</th>
                        <th className="py-1 pr-3">Rate</th>
                        <th className="py-1 pr-3">Source</th>
                        <th className="py-1 pr-3">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rates.map(r => (
                        <tr key={r.id} className="border-t">
                          <td className="py-1 pr-3">{r.date}</td>
                          <td className="py-1 pr-3">₹{r.rate}</td>
                          <td className="py-1 pr-3">{r.source || '—'}</td>
                          <td className="py-1 pr-3">{r.created_at ? fmtDT(r.created_at) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Heatmap */}
          <div className="lg:col-span-3 rounded-xl border bg-white p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-lg font-semibold">Occupancy heatmap (6 weeks)</h2>
                <p className="text-sm text-muted-foreground">Dark cells indicate days with a stay; today is outlined.</p>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {heatmapDays.map((d, idx) => {
                const occ = filteredStays.some(s => overlapsDay(s, d));
                const isToday = sameDay(d, today);
                return (
                  <div key={idx}
                       className={`aspect-square rounded ${occ ? 'bg-emerald-500' : 'bg-gray-200'} ${isToday ? 'ring-2 ring-indigo-500' : ''}`}
                       title={`${d.toDateString()} — ${occ ? 'Occupied' : 'Vacant'}`}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
