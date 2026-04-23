// web/src/routes/OwnerHousekeeping.tsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  Search, ChevronDown, X, RefreshCw, Clock, AlertTriangle,
  CheckCircle2, Sparkles, Eye, Play, Pause, WrenchIcon, User,
  Timer, ChevronRight, Bed, Building2, ChevronLeft, BedDouble, Wrench
} from "lucide-react";

/* ─────── types ─────── */
interface HKRoom {
  room_id: string;
  hotel_id: string;
  room_number: string;
  floor: number | null;
  housekeeping_status: "clean" | "dirty" | "pickup" | "inspected" | "out_of_order" | "in_progress";
  is_out_of_order: boolean;
  room_type_id: string | null;
  room_type_name: string | null;
  task_id: string | null;
  task_status: string | null;
  task_assigned_to: string | null;
  task_started_at: string | null;
  task_eta: string | null;
  task_priority_score: number | null;
  assigned_staff_name: string;
  arrival_needed_in_minutes: number | null;
  arrival_urgency: string | null;
  arrival_booking_id: string | null;
  arrival_booking_code: string | null;
  arrival_guest_name: string | null;
  arrival_checkin_at: string | null;
  arrival_blocked: boolean;
  room_updated_at: string;
  last_task_completed_at: string | null;
  last_task_started_at: string | null;
  last_cleaner_name: string | null;
}

interface HKEvent {
  id: string; event_type: string; old_status: string;
  new_status: string; changed_at: string; notes: string | null; details: any;
}

/* ─────── sub-components ─────── */

/* ── Confirmation Modal for Room Status ── */

/* ── Inspect Modal ── */
const InspectModal = ({ room, onConfirm, onClose, loading }: { room: HKRoom; onConfirm: (a: string) => void; onClose: () => void; loading: boolean }) => {
  const cleanedAt = room.last_task_completed_at ? new Date(room.last_task_completed_at) : null;
  const startedAt = room.last_task_started_at ? new Date(room.last_task_started_at) : null;
  const duration = cleanedAt && startedAt ? Math.round((cleanedAt.getTime() - startedAt.getTime()) / 60000) : null;
  const timeAgo = cleanedAt ? Math.round((new Date().getTime() - cleanedAt.getTime()) / 60000) : null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="bg-slate-800 px-6 py-4 flex justify-between items-center text-white">
          <h3 className="text-lg font-bold">Inspect Room</h3>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6">
          <div className="mb-6">
            <h2 className="text-xl font-black text-slate-900">Room {room.room_number}</h2>
            <p className="text-sm text-slate-500">{room.room_type_name || "Standard Room"}</p>
          </div>

          <div className="space-y-4 mb-8">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center text-violet-600 font-bold text-xs uppercase">{room.last_cleaner_name?.charAt(0) || "U"}</div>
              <span className="text-sm font-semibold text-slate-700">{room.last_cleaner_name || "Unassigned"}</span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-emerald-600">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-sm font-bold">Cleaned {timeAgo !== null ? `${timeAgo} mins ago` : "recently"}</span>
              </div>
              <div className="flex items-center gap-2 text-slate-400">
                <Clock className="w-4 h-4" />
                <span className="text-xs">{duration !== null ? `${duration} min duration` : "Unknown duration"}</span>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100">
              <div className="flex items-center gap-2 text-slate-400 text-xs">
                <Building2 className="w-3.5 h-3.5" />
                <span>Floor {room.floor} · {room.room_type_name}</span>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <button onClick={() => onConfirm("mark_inspected")} disabled={loading} className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-emerald-500/20">
              <CheckCircle2 className="w-5 h-5" /> Mark Inspected
            </button>
            <button onClick={() => onConfirm("reopen")} disabled={loading} className="w-full py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-orange-500/20">
              <RefreshCw className="w-5 h-5" /> Reopen Cleaning
            </button>
            <button onClick={onClose} className="w-full py-3 text-slate-500 font-bold hover:text-slate-700 transition">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ── Resolve Modal ── */
const ResolveModal = ({ room, onConfirm, onClose, loading }: { room: HKRoom; onConfirm: (a: string) => void; onClose: () => void; loading: boolean }) => (
  <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
      <div className="bg-slate-800 px-6 py-4 flex justify-between items-center text-white">
        <h3 className="text-lg font-bold">Resolve Room</h3>
        <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition"><X className="w-5 h-5" /></button>
      </div>
      <div className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <h2 className="text-xl font-black text-slate-900">Room {room.room_number}</h2>
          <span className="px-2 py-0.5 bg-red-100 text-red-600 text-[10px] font-black rounded uppercase">Out of Order</span>
        </div>

        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 mb-8">
          <div className="flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <p className="text-sm font-bold text-amber-900 mb-1">Resolve Out of Order Status</p>
              <p className="text-xs text-amber-700">Mark this room as available for cleaning? Current out of order status and notes will be cleared.</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <button onClick={() => onConfirm("resolve_dirty")} disabled={loading} className="py-4 bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 disabled:opacity-50">
            <RefreshCw className="w-4 h-4" /> Mark Dirty
          </button>
          <button onClick={() => onConfirm("resolve_clean")} disabled={loading} className="py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 disabled:opacity-50">
            <CheckCircle2 className="w-4 h-4" /> Mark Clean
          </button>
        </div>
        <button onClick={onClose} className="w-full py-3 text-slate-500 font-bold hover:text-slate-700 transition">Cancel</button>
      </div>
    </div>
  </div>
);

const KPICard = ({ label, count, bg, active, onClick, icon }: {
  label: string; count: number; bg: string; icon: any;
  active?: boolean; onClick?: () => void;
}) => {
  const colorMap: Record<string, string> = {
    "bg-red-500": "from-red-600 to-red-900 border-red-500/50 shadow-red-500/20",
    "bg-orange-500": "from-orange-600 to-orange-900 border-orange-500/50 shadow-orange-500/20",
    "bg-emerald-500": "from-emerald-600 to-emerald-900 border-emerald-500/50 shadow-emerald-500/20",
    "bg-blue-600": "from-blue-600 to-blue-900 border-blue-500/50 shadow-blue-500/20",
    "bg-violet-600": "from-violet-600 to-violet-900 border-violet-500/50 shadow-violet-500/20",
    "bg-slate-700": "from-slate-700 to-slate-900 border-slate-500/50 shadow-slate-500/10",
    "bg-gray-600": "from-gray-600 to-gray-800 border-gray-500/50 shadow-gray-500/10",
    "bg-pink-600": "from-pink-500 to-rose-700 border-pink-500/50 shadow-pink-500/30"
  };
  const gradient = colorMap[bg] || "from-slate-800 to-slate-900 border-white/10";

  return (
    <button onClick={onClick}
      className={`relative p-4 rounded-2xl bg-gradient-to-br ${gradient} border backdrop-blur-md text-white shadow-xl flex flex-col justify-between w-full text-left transition-all hover:scale-[1.03] ${active ? "ring-2 ring-white/50 scale-[1.05] z-10" : "opacity-80 hover:opacity-100"}`}
    >
      <div className="flex justify-between items-start w-full">
        <span className="text-[10px] font-black text-white/60 uppercase tracking-widest">{label}</span>
        <div className="p-1.5 bg-white/10 rounded-lg">{icon}</div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-4xl font-black tracking-tight">{count}</span>
      </div>
    </button>
  );
};

const PhysicalStatusBadge = ({ room }: { room: HKRoom }) => {
  const base = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black border shadow-sm whitespace-nowrap uppercase tracking-wider";
  const s = room.housekeeping_status;
  const ts = room.task_status;

  if (s === "dirty" && ts === "in_progress") {
    return (
      <div className="flex items-center gap-1.5">
        <span className={`${base} bg-red-500/10 text-red-400 border-red-500/20`}>
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_red]" /> Dirty
        </span>
        <span className="text-[10px] text-blue-400 font-bold">▸ Progress</span>
      </div>
    );
  }
  if (s === "dirty") return <span className={`${base} bg-red-500/10 text-red-400 border-red-500/20`}><div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_red]" /> Dirty</span>;
  if (s === "in_progress") return <span className={`${base} bg-blue-500/10 text-blue-400 border-blue-500/20`}><div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_blue]" /> Cleaning</span>;
  if (s === "pickup") return <span className={`${base} bg-amber-500/10 text-amber-400 border-amber-500/20`}><Pause className="w-3 h-3" /> Paused</span>;
  if (s === "clean") return <span className={`${base} bg-emerald-500/10 text-emerald-400 border-emerald-500/20`}><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_emerald]" /> Clean</span>;
  if (s === "inspected") return <span className={`${base} bg-blue-500/10 text-blue-400 border-blue-500/20`}><div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_blue]" /> Inspected</span>;
  if (s === "out_of_order") return <span className={`${base} bg-gray-500/10 text-gray-400 border-gray-500/20`}>OOO</span>;
  return <span className={`${base} bg-white/5 text-gray-400 border-white/10`}>Unknown</span>;
};

const ArrivalImpactCell = ({ room }: { room: HKRoom }) => {
  const s = room.housekeeping_status;
  const mins = room.arrival_needed_in_minutes;
  const base = "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border";

  // CASE A: No upcoming arrival
  if (!mins) return <span className="text-gray-300">—</span>;

  // CASE F: Out of Order + Arrival
  if (s === "out_of_order") return (
    <span className={`${base} bg-gray-900 text-white border-gray-700`}>
      <AlertTriangle className="w-3 h-3" /> BLOCKED
    </span>
  );

  // CASE B: Room is already ready (clean/inspected)
  if (s === "clean" || s === "inspected") return (
    <span className={`${base} bg-emerald-50 text-emerald-700 border-emerald-200`}>
      <CheckCircle2 className="w-3 h-3" /> On Track
    </span>
  );

  // CASE C/D/E: Room NOT ready + arrival incoming
  if (mins <= 60) return (
    <div className="flex flex-col gap-0.5">
      <span className={`${base} bg-red-100 text-red-700 border-red-200 animate-pulse`}>
        <AlertTriangle className="w-3 h-3" /> CRITICAL · {mins}m
      </span>
      {room.arrival_guest_name && <span className="text-[10px] text-gray-500">{room.arrival_guest_name}</span>}
    </div>
  );
  if (mins <= 180) return (
    <div className="flex flex-col gap-0.5">
      <span className={`${base} bg-orange-50 text-orange-600 border-orange-200`}>
        <Clock className="w-3 h-3" /> HIGH · {Math.floor(mins / 60)}h {mins % 60}m
      </span>
      {room.arrival_guest_name && <span className="text-[10px] text-gray-500">{room.arrival_guest_name}</span>}
    </div>
  );
  return (
    <span className={`${base} bg-blue-50 text-blue-600 border-blue-100`}>
      <Clock className="w-3 h-3" /> MEDIUM · {Math.floor(mins / 60)}h
    </span>
  );
};

const WorkflowCell = ({ room }: { room: HKRoom }) => {
  const s = room.housekeeping_status;
  const map: Record<string, { label: string; cls: string }> = {
    dirty: { label: "Waiting Cleaning", cls: "text-red-600" },
    in_progress: { label: "Cleaning", cls: "text-blue-600" },
    pickup: { label: "Pickup", cls: "text-amber-600" },
    clean: { label: "Pending Inspection", cls: "text-violet-600" },
    inspected: { label: "Ready", cls: "text-emerald-600" },
    out_of_order: { label: "Maintenance", cls: "text-gray-600" },
  };
  const m = map[s] || { label: s.replace(/_/g, " "), cls: "text-gray-500" };
  return <span className={`text-sm font-semibold ${m.cls}`}>{m.label}</span>;
};

const ActionButton = ({ label, icon, cls, onClick, disabled }: {
  label: string; icon: any; cls: string; onClick: () => void; disabled: boolean;
}) => (
  <button onClick={onClick} disabled={disabled}
    className={`px-3 py-1.5 rounded-lg text-white text-xs font-bold transition flex items-center gap-1 disabled:opacity-50 shadow-sm ${cls}`}
  >{icon} {label}</button>
);

/* ─────── Status Confirmation Popup ─────── */
const StatusConfirmPopup = ({ room, onClose, onConfirm, loading }: {
  room: HKRoom; onClose: () => void; onConfirm: (a: string) => void; loading: boolean;
}) => (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md" onClick={onClose}>
    <div className="bg-[#1a1c1e] border border-white/10 rounded-3xl shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)] w-full max-w-sm mx-4 overflow-hidden animate-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
      <div className="bg-gradient-to-r from-indigo-600/20 to-blue-600/20 px-6 py-5 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
            <Bed className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <div className="text-white font-black text-lg">Room {room.room_number}</div>
            <div className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">{room.room_type_name || "Standard"}</div>
          </div>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-white transition"><X className="w-5 h-5" /></button>
      </div>
      
      <div className="p-6 space-y-3">
        <h3 className="font-black text-white text-center text-sm uppercase tracking-widest mb-4 opacity-50">Confirm Status Update</h3>
        <button onClick={() => onConfirm("dirty")} disabled={loading} className="w-full flex items-center justify-between px-5 py-4 rounded-2xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 font-black text-sm transition group active:scale-[0.98]">
          <span className="flex items-center gap-3"><X className="w-5 h-5" /> Mark Dirty</span>
          <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition" />
        </button>
        <button onClick={() => onConfirm("vacant_clean")} disabled={loading} className="w-full flex items-center justify-between px-5 py-4 rounded-2xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-500 font-black text-sm transition group active:scale-[0.98]">
          <span className="flex items-center gap-3"><Sparkles className="w-5 h-5" /> Vacant Clean</span>
          <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition" />
        </button>
        <button onClick={() => onConfirm("occupied_clean")} disabled={loading} className="w-full flex items-center justify-between px-5 py-4 rounded-2xl bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 font-black text-sm transition group active:scale-[0.98]">
          <span className="flex items-center gap-3"><User className="w-5 h-5" /> Occupied Clean</span>
          <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition" />
        </button>
        <button onClick={() => onConfirm("pause")} disabled={loading} className="w-full flex items-center justify-between px-5 py-4 rounded-2xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-500 font-black text-sm transition group active:scale-[0.98]">
          <span className="flex items-center gap-3"><Pause className="w-5 h-5" /> Pause Tracking</span>
          <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition" />
        </button>
        
        <button onClick={onClose} className="w-full py-3 text-slate-500 font-bold text-xs uppercase tracking-widest hover:text-slate-300 transition mt-4">Dismiss</button>
      </div>
    </div>
  </div>
);

/* ─────── Arrival Dashboard Sidebar ─────── */
const ArrivalDashboard = ({ rooms, onClose }: { rooms: HKRoom[]; onClose: () => void }) => {
  const criticalRooms = rooms.filter(r => r.arrival_blocked && r.arrival_urgency && ["CRITICAL", "HIGH"].includes(r.arrival_urgency));
  const allBlockedRooms = rooms
    .filter(r => r.arrival_blocked)
    .sort((a, b) => {
      const rank = (u: string | null) => u === "CRITICAL" ? 0 : u === "HIGH" ? 1 : u === "MEDIUM" ? 2 : 3;
      return rank(a.arrival_urgency) - rank(b.arrival_urgency);
    });
  const [tab, setTab] = useState<"all" | "urgency">("all");

  const urgencyColor = (u: string | null) => {
    if (u === "CRITICAL") return { bg: "bg-red-500/10", border: "border-red-500/10", text: "text-red-400", dot: "bg-red-500", badge: "bg-red-500/20 text-red-400" };
    if (u === "HIGH") return { bg: "bg-orange-500/10", border: "border-orange-500/10", text: "text-orange-400", dot: "bg-orange-500", badge: "bg-orange-500/20 text-orange-400" };
    if (u === "MEDIUM") return { bg: "bg-amber-500/10", border: "border-amber-500/10", text: "text-amber-400", dot: "bg-amber-500", badge: "bg-amber-500/20 text-amber-400" };
    return { bg: "bg-slate-500/10", border: "border-slate-500/10", text: "text-slate-400", dot: "bg-slate-500", badge: "bg-slate-500/20 text-slate-400" };
  };

  const displayRooms = tab === "all" ? criticalRooms : allBlockedRooms;

  return (
    <div className="w-[320px] bg-[#1a1c1e] border-l border-white/5 flex flex-col h-full shrink-0 overflow-hidden shadow-2xl">
      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
        <h2 className="font-black text-white text-sm uppercase tracking-widest">Arrival Monitor</h2>
        <button onClick={onClose} className="text-slate-500 hover:text-white transition"><X className="w-4 h-4" /></button>
      </div>

      <div className="px-4 pt-4 flex gap-2">
        <button onClick={() => setTab("all")} className={`flex-1 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition relative ${tab === "all" ? "bg-red-600 text-white shadow-lg shadow-red-600/20" : "bg-white/5 text-slate-500 hover:bg-white/10"}`}>
          Alerts
          {criticalRooms.length > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-[8px] flex items-center justify-center text-white font-black">{criticalRooms.length}</span>}
        </button>
        <button onClick={() => setTab("urgency")} className={`flex-1 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition relative ${tab === "urgency" ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20" : "bg-white/5 text-slate-500 hover:bg-white/10"}`}>
          Queue
          {allBlockedRooms.length > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-indigo-500 text-[8px] flex items-center justify-center text-white font-black">{allBlockedRooms.length}</span>}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3">
        {displayRooms.length === 0 && (
          <div className="text-center py-12">
            <Sparkles className="w-10 h-10 text-slate-800 mx-auto mb-3" />
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
              {tab === "all" ? "No Critical Alerts" : "All Rooms Ready"}
            </p>
            <p className="text-[9px] text-slate-700 mt-1">
              {tab === "all" ? "No guests arriving with unready rooms" : "No arrival-blocked rooms in queue"}
            </p>
          </div>
        )}
        {displayRooms.map(room => {
          const c = urgencyColor(room.arrival_urgency);
          return (
            <div key={room.room_id} className={`bg-white/5 border border-white/5 rounded-2xl overflow-hidden hover:border-white/10 transition-colors`}>
              <div className={`${c.bg} px-3 py-2 border-b ${c.border} flex items-center justify-between`}>
                <div className="flex items-center gap-2">
                  <span className={`font-black text-[11px] ${c.text}`}>ROOM {room.room_number}</span>
                  <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase ${c.badge}`}>{room.arrival_urgency}</span>
                </div>
                {room.arrival_needed_in_minutes != null && (
                  <div className="flex items-center gap-1.5 animate-pulse">
                    <div className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                    <span className={`text-[10px] font-black ${c.text} uppercase tracking-wider`}>{room.arrival_needed_in_minutes}m</span>
                  </div>
                )}
              </div>
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <PhysicalStatusBadge room={room} />
                  <span className="text-[9px] font-bold text-slate-600">{room.assigned_staff_name}</span>
                </div>
                {room.arrival_guest_name && (
                  <div className="space-y-0.5">
                    <div className="text-[11px] font-black text-slate-100 uppercase">{room.arrival_guest_name}</div>
                    <div className="text-[10px] text-slate-500 font-bold tracking-tight">Booking: {room.arrival_booking_code}</div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary stats footer */}
      <div className="px-4 py-3 border-t border-white/5 bg-white/[0.01] grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-[16px] font-black text-red-400">{rooms.filter(r => r.arrival_blocked && r.arrival_urgency === "CRITICAL").length}</div>
          <div className="text-[8px] font-bold text-slate-600 uppercase">Critical</div>
        </div>
        <div>
          <div className="text-[16px] font-black text-orange-400">{rooms.filter(r => r.arrival_blocked && r.arrival_urgency === "HIGH").length}</div>
          <div className="text-[8px] font-bold text-slate-600 uppercase">High</div>
        </div>
        <div>
          <div className="text-[16px] font-black text-amber-400">{allBlockedRooms.length}</div>
          <div className="text-[8px] font-bold text-slate-600 uppercase">Total</div>
        </div>
      </div>
    </div>
  );
};

const ArrivalImpactCard = ({ room }: { room: HKRoom }) => {
  if (!room.arrival_blocked) return null;
  const isCritical = room.arrival_urgency === "CRITICAL";
  return (
    <div className={`px-5 py-3 border-b shrink-0 ${isCritical ? "bg-red-50 border-red-100" : "bg-amber-50 border-amber-100"}`}>
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle className={`w-4 h-4 ${isCritical ? "text-red-600" : "text-amber-600"}`} />
        <span className={`font-bold text-sm ${isCritical ? "text-red-700" : "text-amber-700"}`}>
          Arrival {room.arrival_urgency} — {room.arrival_needed_in_minutes}m
        </span>
      </div>
      <p className="text-xs text-gray-600">Room needed for <strong>{room.arrival_guest_name}</strong>. Booking: {room.arrival_booking_code}</p>
    </div>
  );
};

/* ── Room Detail Drawer ── */
const RoomDrawer = ({ room, events, onClose, onAction, actionLoading }: {
  room: HKRoom; events: HKEvent[]; onClose: () => void;
  onAction: (a: string, id: string) => void; actionLoading: boolean;
}) => {
  const [checklist, setChecklist] = useState({
    bedding: false,
    bath: false,
    minibar: false,
    surface: false
  });

  const isComplete = checklist.bedding && checklist.bath && checklist.minibar && checklist.surface;

  return (
    <div className="w-[400px] bg-[#1a1c1e] border-l border-white/5 flex flex-col h-full overflow-hidden shadow-2xl">
      <div className="bg-gradient-to-r from-[#111315] to-[#1a1c1e] px-6 py-6 border-b border-white/5 flex items-center justify-between shrink-0">
        <div>
          <div className="text-white font-black text-2xl tracking-tight">Room {room.room_number}</div>
          <div className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">{room.room_type_name || "Standard Unit"} · Floor {room.floor || "—"}</div>
        </div>
        <button onClick={onClose} className="p-2 bg-white/5 hover:bg-white/10 rounded-xl transition text-slate-500 hover:text-white"><X className="w-5 h-5" /></button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
        {/* ── Status Section ── */}
        <div className="space-y-4">
          <h4 className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Operational Status</h4>
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400">Current Standing</span>
            <PhysicalStatusBadge room={room} />
          </div>
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400">Assigned Personnel</span>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[10px] font-black">{room.assigned_staff_name?.charAt(0)}</div>
              <span className="text-sm font-black text-slate-200">{room.assigned_staff_name}</span>
            </div>
          </div>
        </div>

        {/* ── Checklist Section (Only for Clean/Inspection Pending) ── */}
        {room.housekeeping_status === "clean" && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <h4 className="text-[10px] font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-indigo-500"></span>
              Sanitation Protocol
            </h4>
            <div className="space-y-2">
              {[
                { id: 'bedding', label: "Bedding Replacement", icon: Bed },
                { id: 'bath', label: "Bath Sanitation", icon: Sparkles },
                { id: 'minibar', label: "Refresh Minibar", icon: RefreshCw },
                { id: 'surface', label: "Surface Disinfection", icon: CheckCircle2 }
              ].map(item => (
                <button
                  key={item.id}
                  onClick={() => setChecklist(prev => ({ ...prev, [item.id]: !prev[item.id as keyof typeof prev] }))}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all duration-300 ${
                    checklist[item.id as keyof typeof checklist] 
                    ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-200" 
                    : "bg-white/[0.02] border-white/5 text-slate-500 hover:border-white/20"
                  }`}
                >
                  <div className={`w-5 h-5 rounded-lg flex items-center justify-center transition-colors ${checklist[item.id as keyof typeof checklist] ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/40" : "bg-white/5"}`}>
                    {checklist[item.id as keyof typeof checklist] ? <CheckCircle2 className="w-3 h-3" /> : <item.icon className="w-3 h-3" />}
                  </div>
                  <span className="text-[11px] font-black uppercase tracking-wide">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Actions Section ── */}
        <div className="space-y-4">
          <h4 className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Available Operations</h4>
          <div className="grid grid-cols-1 gap-2.5">
            {room.housekeeping_status === "dirty" && !room.task_status?.includes("in_progress") && (
              <button onClick={() => onAction("start", room.room_id)} disabled={actionLoading} className="w-full flex items-center gap-4 px-5 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-sm transition shadow-lg shadow-indigo-600/10">
                <Play className="w-5 h-5" /> Initiate Cleaning Protocol
              </button>
            )}
            {(room.task_status === "in_progress" || room.housekeeping_status === "in_progress") && (
              <button onClick={() => onAction("complete_popup", room.room_id)} disabled={actionLoading} className="w-full flex items-center gap-4 px-5 py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-sm transition shadow-lg shadow-emerald-600/10">
                <CheckCircle2 className="w-5 h-5" /> Finalize Sanitation
              </button>
            )}
            {room.housekeeping_status === "clean" && (
              <div className="space-y-3">
                <button 
                  onClick={() => onAction("inspect", room.room_id)} 
                  disabled={actionLoading || !isComplete} 
                  className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl font-black text-sm transition shadow-lg ${
                    isComplete 
                    ? "bg-violet-600 hover:bg-violet-700 text-white shadow-violet-600/10" 
                    : "bg-white/5 text-slate-600 cursor-not-allowed border border-white/5"
                  }`}
                >
                  <Eye className="w-5 h-5" /> {isComplete ? "Dispatch Inspector" : "Complete Protocol to Inspect"}
                </button>
                {!isComplete && <p className="text-[10px] text-center text-slate-600 font-bold uppercase tracking-widest animate-pulse">Check all protocol items to proceed</p>}
              </div>
            )}
            {room.housekeeping_status === "inspected" && (
              <button onClick={() => onAction("reopen", room.room_id)} disabled={actionLoading} className="w-full flex items-center gap-4 px-5 py-4 bg-amber-600 hover:bg-amber-700 text-white rounded-2xl font-black text-sm transition shadow-lg shadow-amber-600/10">
                <RefreshCw className="w-5 h-5" /> De-certify & Reopen
              </button>
            )}
            {room.housekeeping_status === "out_of_order" && (
              <button onClick={() => onAction("resolve", room.room_id)} disabled={actionLoading} className="w-full flex items-center gap-4 px-5 py-4 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl font-black text-sm transition shadow-lg shadow-orange-600/10">
                <Wrench className="w-5 h-5" /> Resolve Maintenance Flag
              </button>
            )}
          </div>
        </div>

        {/* ── Timeline Section ── */}
        <div className="space-y-6">
          <h4 className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Event Log</h4>
          <div className="space-y-6 relative before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-px before:bg-white/5">
            {events.length === 0 ? (
              <p className="text-xs text-slate-600 italic">No operational events logged.</p>
            ) : (
              events.map(evt => (
                <div key={evt.id} className="relative pl-8">
                  <div className="absolute left-0 top-1.5 w-5 h-5 rounded-full bg-[#111315] border border-white/10 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  </div>
                  <div>
                    <div className="text-[11px] font-black text-slate-200 uppercase tracking-wide">{evt.event_type?.replace(/_/g, " ") || "Status Transition"}</div>
                    <div className="text-[10px] text-slate-500 font-bold mt-0.5">{new Date(evt.changed_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                    {evt.notes && <div className="mt-2 p-2 bg-white/[0.02] border border-white/5 rounded-lg text-[10px] text-slate-400 leading-relaxed">{evt.notes}</div>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════ */

export default function OwnerHousekeeping() {
  const { slug } = useParams();
  const [hotelId, setHotelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<HKRoom[]>([]);
  const [roomTypes, setRoomTypes] = useState<{ id: string; name: string }[]>([]);
  const [staffList, setStaffList] = useState<{ id: string; name: string }[]>([]);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [roomTypeFilter, setRoomTypeFilter] = useState<string | null>(null);
  const [floorFilter, setFloorFilter] = useState<string | null>(null);
  const [arrivalFilter, setArrivalFilter] = useState<string | null>(null);
  const [assignedFilter, setAssignedFilter] = useState<string | null>(null);
  const [autoPriority, setAutoPriority] = useState(true);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [showArrivalPanel, setShowArrivalPanel] = useState(true);
  const [bulkAssignStaff, setBulkAssignStaff] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Drawer & popup
  const [selectedRoom, setSelectedRoom] = useState<HKRoom | null>(null);
  const [drawerEvents, setDrawerEvents] = useState<HKEvent[]>([]);
  const [popupRoom, setPopupRoom] = useState<HKRoom | null>(null);
  const [inspectRoom, setInspectRoom] = useState<HKRoom | null>(null);
  const [resolveRoom, setResolveRoom] = useState<HKRoom | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 9;

  // Hotel load
  useEffect(() => {
    if (!slug) return;
    (async () => {
      const { data } = await supabase.from("hotels").select("id").eq("slug", slug).single();
      if (data) setHotelId(data.id);
    })();
  }, [slug]);

  // Fetch board
  const fetchBoard = useCallback(async () => {
    if (!hotelId) return;
    const { data } = await supabase
      .from("v_housekeeping_operational_board")
      .select("*").eq("hotel_id", hotelId).order("room_number", { ascending: true });
    if (data) setRooms(data as HKRoom[]);
    setLoading(false);
  }, [hotelId]);

  useEffect(() => {
    if (!hotelId) return;
    fetchBoard();
    const channel = supabase.channel("hk-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, fetchBoard)
      .on("postgres_changes", { event: "*", schema: "public", table: "housekeeping_tasks" }, fetchBoard)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [hotelId, fetchBoard]);

  // Room types + staff
  useEffect(() => {
    if (!hotelId) return;
    (async () => {
      const [rtRes, staffRes] = await Promise.all([
        supabase.from("room_types").select("id, name").eq("hotel_id", hotelId).eq("is_active", true).order("name"),
        supabase.from("hotel_members").select("id, user_id, role").eq("hotel_id", hotelId).eq("is_active", true),
      ]);
      if (rtRes.data) setRoomTypes(rtRes.data);
      if (staffRes.data && staffRes.data.length > 0) {
        const userIds = staffRes.data.map((s: any) => s.user_id);
        const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
        const profileMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name]));
        setStaffList(staffRes.data.map((s: any) => ({
          id: s.id,
          name: profileMap.get(s.user_id) || s.role || "Staff",
        })));
      }
    })();
  }, [hotelId]);

  // Events for drawer
  useEffect(() => {
    if (!selectedRoom) { setDrawerEvents([]); return; }
    (async () => {
      const { data } = await supabase.from("housekeeping_events").select("*").eq("room_id", selectedRoom.room_id).order("changed_at", { ascending: false }).limit(20);
      if (data) setDrawerEvents(data as HKEvent[]);
    })();
  }, [selectedRoom]);

  // Stats
  const stats = useMemo(() => ({
    dirty: rooms.filter(r => r.housekeeping_status === "dirty").length,
    inProgress: rooms.filter(r => r.housekeeping_status === "in_progress" || r.task_status === "in_progress").length,
    clean: rooms.filter(r => r.housekeeping_status === "inspected").length,
    inspectionPending: rooms.filter(r => r.housekeeping_status === "clean").length,
    arrivalCritical: rooms.filter(r => r.arrival_blocked && r.arrival_urgency && ["CRITICAL", "HIGH"].includes(r.arrival_urgency)).length,
    arrivalCDOR: rooms.filter(r => r.arrival_blocked && r.housekeeping_status === "dirty").length,
    outOfOrder: rooms.filter(r => r.is_out_of_order).length,
    total: rooms.length,
  }), [rooms]);

  const floors = useMemo(() => {
    const set = new Set(rooms.map(r => r.floor).filter(f => f !== null) as number[]);
    return Array.from(set).sort((a, b) => a - b);
  }, [rooms]);

  // Filtering
  const filteredRooms = useMemo(() => {
    let result = rooms;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(r => r.room_number.toLowerCase().includes(q) || (r.arrival_guest_name || "").toLowerCase().includes(q) || (r.arrival_booking_code || "").toLowerCase().includes(q));
    }
    if (statusFilter) {
      if (statusFilter === "dirty") result = result.filter(r => r.housekeeping_status === "dirty");
      else if (statusFilter === "in_progress") result = result.filter(r => r.housekeeping_status === "in_progress" || r.task_status === "in_progress");
      else if (statusFilter === "clean") result = result.filter(r => r.housekeeping_status === "inspected");
      else if (statusFilter === "inspection") result = result.filter(r => r.housekeeping_status === "clean");
      else if (statusFilter === "ooo") result = result.filter(r => r.is_out_of_order);
      else if (statusFilter === "arrival_urgent") result = result.filter(r => r.arrival_blocked && r.arrival_urgency && ["CRITICAL", "HIGH"].includes(r.arrival_urgency));
      else if (statusFilter === "arrival_cdor") result = result.filter(r => r.arrival_blocked && r.housekeeping_status === "dirty");
    }
    if (roomTypeFilter) result = result.filter(r => r.room_type_id === roomTypeFilter);
    if (floorFilter) result = result.filter(r => r.floor === parseInt(floorFilter));
    if (arrivalFilter === "blocked") result = result.filter(r => r.arrival_blocked);
    if (assignedFilter) result = result.filter(r => r.task_assigned_to === assignedFilter);
    if (autoPriority) {
      result = [...result].sort((a, b) => {
        const urgencyRank = (u: string | null) => u === "CRITICAL" ? 0 : u === "HIGH" ? 1 : u === "MEDIUM" ? 2 : 3;
        const aR = a.arrival_blocked ? urgencyRank(a.arrival_urgency) : 4;
        const bR = b.arrival_blocked ? urgencyRank(b.arrival_urgency) : 4;
        if (aR !== bR) return aR - bR;
        return a.room_number.localeCompare(b.room_number);
      });
    }
    return result;
  }, [rooms, search, statusFilter, roomTypeFilter, floorFilter, arrivalFilter, assignedFilter, autoPriority]);

  const totalPages = Math.ceil(filteredRooms.length / pageSize);
  const paginatedRooms = useMemo(() => filteredRooms.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filteredRooms, currentPage]);

  useEffect(() => { setCurrentPage(1); }, [search, statusFilter, roomTypeFilter, floorFilter, arrivalFilter, assignedFilter]);

  // Actions
  const handleAction = async (action: string, roomId: string) => {
    const room = rooms.find(r => r.room_id === roomId);
    if (!room) return;
    if (action === "clean" || action === "complete_popup") {
      const rm = rooms.find(r => r.room_id === roomId);
      if (rm) setPopupRoom(rm);
      return;
    }
    if (action === "inspect") {
      const rm = rooms.find(r => r.room_id === roomId);
      if (rm) setInspectRoom(rm);
      return;
    }
    if (action === "resolve") {
      const rm = rooms.find(r => r.room_id === roomId);
      if (rm) setResolveRoom(rm);
      return;
    }

    setActionLoading(true);
    try {
      let result;
      if (action === "start" || action === "resume") {
        result = await supabase.rpc("hk_start_cleaning", { p_room_id: roomId });
      } else if (action === "reopen") {
        result = await supabase.rpc("hk_supervisor_override", {
          p_room_id: roomId,
          p_new_status: "dirty",
          p_reason: "Reopened by supervisor"
        });
      }

      if (result?.error) alert("Error: " + result.error.message);
      else fetchBoard();
    } catch (err) { console.error(err); }
    finally { setActionLoading(false); }
  };

  const handlePopupConfirm = async (action: string) => {
    if (!popupRoom) return;
    setBulkLoading(true);
    try {
      let result;
      if (action === "dirty") result = await supabase.rpc("hk_complete_cleaning", { p_room_id: popupRoom.room_id, p_final_status: "dirty" });
      else if (action === "vacant_clean") result = await supabase.rpc("hk_complete_cleaning", { p_room_id: popupRoom.room_id, p_final_status: "clean" });
      else if (action === "occupied_clean") result = await supabase.rpc("hk_complete_cleaning", { p_room_id: popupRoom.room_id, p_final_status: "inspected" });
      else if (action === "pause") result = await supabase.rpc("hk_pause_cleaning", { p_room_id: popupRoom.room_id });

      if (result?.error) alert("Error: " + result.error.message);
      else {
        setPopupRoom(null);
        fetchBoard();
      }
    } catch (err) { console.error(err); }
    finally { setBulkLoading(false); }
  };

  const handleInspectConfirm = async (action: string) => {
    if (!inspectRoom) return;
    setBulkLoading(true);
    try {
      let result;
      if (action === "mark_inspected") {
        result = await supabase.rpc("hk_supervisor_override", {
          p_room_id: inspectRoom.room_id,
          p_new_status: "inspected",
          p_reason: "Inspected by supervisor"
        });
      } else if (action === "reopen") {
        result = await supabase.rpc("hk_supervisor_override", {
          p_room_id: inspectRoom.room_id,
          p_new_status: "dirty",
          p_reason: "Reopened by supervisor"
        });
      }
      if (result?.error) alert("Error: " + result.error.message);
      else {
        setInspectRoom(null);
        fetchBoard();
      }
    } catch (err) { console.error(err); }
    finally { setBulkLoading(false); }
  };

  const handleResolveConfirm = async (action: string) => {
    if (!resolveRoom) return;
    setBulkLoading(true);
    try {
      let result;
      if (action === "resolve_dirty") {
        result = await supabase.rpc("hk_supervisor_override", {
          p_room_id: resolveRoom.room_id,
          p_new_status: "dirty",
          p_reason: "OOO resolved to dirty"
        });
      } else if (action === "resolve_clean") {
        result = await supabase.rpc("hk_supervisor_override", {
          p_room_id: resolveRoom.room_id,
          p_new_status: "clean",
          p_reason: "OOO resolved to clean"
        });
      }
      if (result?.error) alert("Error: " + result.error.message);
      else {
        setResolveRoom(null);
        fetchBoard();
      }
    } catch (err) { console.error(err); }
    finally { setBulkLoading(false); }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const allSelected = paginatedRooms.length > 0 && paginatedRooms.every(r => selectedRows.has(r.room_id));
  const toggleAll = () => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (allSelected) paginatedRooms.forEach(r => next.delete(r.room_id));
      else paginatedRooms.forEach(r => next.add(r.room_id));
      return next;
    });
  };

  // Quick-select helpers
  const selectAllDirty = () => {
    setSelectedRows(new Set(rooms.filter(r => r.housekeeping_status === "dirty").map(r => r.room_id)));
  };
  const selectAllPendingInspection = () => {
    setSelectedRows(new Set(rooms.filter(r => r.housekeeping_status === "clean").map(r => r.room_id)));
  };
  const selectArrivalCritical = () => {
    setSelectedRows(new Set(rooms.filter(r => r.arrival_blocked && r.arrival_urgency && ["CRITICAL", "HIGH"].includes(r.arrival_urgency)).map(r => r.room_id)));
  };
  const selectUnassigned = () => {
    setSelectedRows(new Set(rooms.filter(r => r.assigned_staff_name === "Unassigned" || !r.task_assigned_to).map(r => r.room_id)));
  };
  const selectFloor = (f: number) => {
    setSelectedRows(new Set(rooms.filter(r => r.floor === f).map(r => r.room_id)));
  };

  // Bulk action handlers
  const selectedIds = Array.from(selectedRows);
  const selCount = selectedIds.length;

  const handleBulkAssign = async () => {
    if (!bulkAssignStaff || selCount === 0) return;
    setBulkLoading(true);
    try {
      const { error } = await supabase.rpc("hk_bulk_assign", { p_room_ids: selectedIds, p_staff_id: bulkAssignStaff });
      if (error) alert("Bulk Assign Error: " + error.message);
      else { 
        setSelectedRows(new Set()); 
        setBulkAssignStaff(null); 
        fetchBoard();
      }
    } catch (err) { console.error(err); }
    finally { setBulkLoading(false); }
  };

  const handleBulkStart = async () => {
    if (selCount === 0) return;
    setBulkLoading(true);
    try {
      const { error } = await supabase.rpc("hk_bulk_start_cleaning", { p_room_ids: selectedIds });
      if (error) alert("Bulk Start Error: " + error.message);
      else { 
        setSelectedRows(new Set());
        fetchBoard();
      }
    } catch (err) { console.error(err); }
    finally { setBulkLoading(false); }
  };

  const handleBulkMarkClean = async () => {
    if (selCount === 0) return;
    setBulkLoading(true);
    try {
      const { error } = await supabase.rpc("hk_bulk_complete_cleaning", { p_room_ids: selectedIds, p_final_status: "clean" });
      if (error) alert("Bulk Clean Error: " + error.message);
      else { 
        setSelectedRows(new Set());
        fetchBoard();
      }
    } catch (err) { console.error(err); }
    finally { setBulkLoading(false); }
  };

  const handleBulkMarkInspected = async () => {
    if (selCount === 0) return;
    setBulkLoading(true);
    try {
      const { error } = await supabase.rpc("hk_bulk_supervisor_override", { p_room_ids: selectedIds, p_new_status: "inspected", p_reason: "Bulk inspected by supervisor" });
      if (error) alert("Bulk Inspect Error: " + error.message);
      else { 
        setSelectedRows(new Set());
        fetchBoard();
      }
    } catch (err) { console.error(err); }
    finally { setBulkLoading(false); }
  };

  const handleBulkOOO = async () => {
    if (selCount === 0) return;
    setBulkLoading(true);
    try {
      const { error } = await supabase.rpc("hk_bulk_mark_out_of_order", { p_room_ids: selectedIds, p_reason: "Supervisor bulk action" });
      if (error) alert("Bulk OOO Error: " + error.message);
      else { 
        setSelectedRows(new Set());
        fetchBoard();
      }
    } catch (err) { console.error(err); }
    finally { setBulkLoading(false); }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading Housekeeping Board...</div>;

  return (
    <div className="min-h-screen lg:h-screen w-full flex flex-col lg:flex-row bg-[#0f1113] text-white overflow-y-auto lg:overflow-hidden font-['Outfit']">
      {/* ───── LEFT: Main Board ───── */}
      <div className="flex-1 flex flex-col min-w-0 lg:overflow-hidden">
        {/* Header Section */}
        <div className="bg-[#16181b] border-b border-white/[0.05] px-6 py-4 shrink-0 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/20">
                <Sparkles className="w-6 h-6 text-indigo-400" />
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
                  Housekeeping <span className="text-indigo-400">Management</span>
                </h1>
                <p className="text-xs text-slate-400 font-medium">{rooms.length} rooms total · Real-time Operational Board</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-full border border-white/10">
                <span className="text-[10px] font-bold text-slate-500">Auto-Priority</span>
                <button
                  onClick={() => setAutoPriority(!autoPriority)}
                  className={`w-8 h-4 rounded-full transition-colors relative ${autoPriority ? "bg-indigo-600" : "bg-white/10"}`}
                >
                  <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${autoPriority ? "left-4" : "left-0.5"}`} />
                </button>
              </div>
              <button onClick={() => fetchBoard()} className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition text-slate-400">
                <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* KPI Row - Responsive */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <KPICard label="Dirty Rooms" count={stats.dirty} bg="bg-red-500" icon={<AlertTriangle className="w-4 h-4" />} active={statusFilter === "dirty"} onClick={() => setStatusFilter(statusFilter === "dirty" ? null : "dirty")} />
            <KPICard label="In Progress" count={stats.inProgress} bg="bg-orange-500" icon={<Play className="w-4 h-4" />} active={statusFilter === "in_progress"} onClick={() => setStatusFilter(statusFilter === "in_progress" ? null : "in_progress")} />
            <KPICard label="Ready / Clean" count={stats.clean} bg="bg-emerald-500" icon={<CheckCircle2 className="w-4 h-4" />} active={statusFilter === "clean"} onClick={() => setStatusFilter(statusFilter === "clean" ? null : "clean")} />
            <KPICard label="Inspection Pending" count={stats.inspectionPending} bg="bg-blue-600" icon={<Eye className="w-4 h-4" />} active={statusFilter === "inspection"} onClick={() => setStatusFilter(statusFilter === "inspection" ? null : "inspection")} />
            <KPICard label="Arrival Criticals" count={stats.arrivalCritical} bg="bg-pink-600" icon={<AlertTriangle className="w-4 h-4 text-white" />} active={statusFilter === "arrival_urgent"} onClick={() => setStatusFilter(statusFilter === "arrival_urgent" ? null : "arrival_urgent")} />
            <KPICard label="Arrival CDOR" count={stats.arrivalCDOR} bg="bg-slate-700" icon={<Timer className="w-4 h-4" />} active={statusFilter === "arrival_cdor"} onClick={() => setStatusFilter(statusFilter === "arrival_cdor" ? null : "arrival_cdor")} />
            <KPICard label="Out of Order" count={stats.outOfOrder} bg="bg-gray-600" icon={<WrenchIcon className="w-4 h-4" />} active={statusFilter === "ooo"} onClick={() => setStatusFilter(statusFilter === "ooo" ? null : "ooo")} />
          </div>
        </div>

        {/* Filters Bar - Wrapped for mobile */}
        <div className="bg-[#0f1113] px-6 py-4 border-b border-white/[0.03]">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative group w-full sm:w-auto flex-1 sm:flex-none">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-indigo-400 transition" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter rooms, guests..."
                className="pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500/40 w-full sm:w-64 transition"
              />
            </div>
            <select
              value={roomTypeFilter || ""}
              onChange={(e) => setRoomTypeFilter(e.target.value || null)}
              className="appearance-none px-3 py-2 bg-[#1a1c1e] border border-white/10 rounded-xl text-xs font-bold text-slate-400 focus:outline-none focus:border-indigo-500/40"
            >
              <option value="">All Room Types</option>
              {roomTypes.map(rt => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
            </select>
            <select
              value={statusFilter || ""}
              onChange={(e) => setStatusFilter(e.target.value || null)}
              className="appearance-none px-3 py-2 bg-[#1a1c1e] border border-white/10 rounded-xl text-xs font-bold text-slate-400 focus:outline-none focus:border-indigo-500/40"
            >
              <option value="">Status: All</option>
              <option value="dirty">Dirty</option>
              <option value="in_progress">Cleaning</option>
              <option value="clean">Clean</option>
              <option value="inspection">Inspection</option>
              <option value="ooo">Out of Order</option>
            </select>
            <select
              value={floorFilter || ""}
              onChange={(e) => setFloorFilter(e.target.value || null)}
              className="appearance-none px-3 py-2 bg-[#1a1c1e] border border-white/10 rounded-xl text-xs font-bold text-slate-400 focus:outline-none focus:border-indigo-500/40"
            >
              <option value="">Zone: All</option>
              {floors.map(f => <option key={f} value={f.toString()}>Floor {f}</option>)}
            </select>
            <select
              value={assignedFilter || ""}
              onChange={(e) => setAssignedFilter(e.target.value || null)}
              className="appearance-none px-3 py-2 bg-[#1a1c1e] border border-white/10 rounded-xl text-xs font-bold text-slate-400 focus:outline-none focus:border-indigo-500/40"
            >
              <option value="">Assigned To: All</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select
              value={arrivalFilter || ""}
              onChange={(e) => setArrivalFilter(e.target.value || null)}
              className="appearance-none px-3 py-2 bg-[#1a1c1e] border border-white/10 rounded-xl text-xs font-bold text-slate-400 focus:outline-none focus:border-indigo-500/40"
            >
              <option value="">Arrival Priority: All</option>
              <option value="blocked">Arrival Blocked</option>
            </select>
            
            <div className="flex items-center gap-2 ml-auto sm:ml-0">
              {!showArrivalPanel && (
                <button onClick={() => setShowArrivalPanel(true)} className="flex items-center gap-1.5 px-3 py-2 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-indigo-500/20 transition">
                  <ChevronLeft className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Show Arrival Dashboard</span> <span className="sm:hidden">Arrivals</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Board Content */}
        <div className="flex-1 lg:overflow-auto overflow-visible bg-[#0f1113] p-6">
          {/* Quick Select Pills — Data-Driven: only shown when matching rooms exist */}
          {(() => {
            const dirtyCount = rooms.filter(r => r.housekeeping_status === "dirty").length;
            const pendingInspCount = rooms.filter(r => r.housekeeping_status === "clean").length;
            const arrivalCritCount = rooms.filter(r => r.arrival_blocked && r.arrival_urgency && ["CRITICAL", "HIGH"].includes(r.arrival_urgency)).length;
            const unassignedCount = rooms.filter(r => r.assigned_staff_name === "Unassigned" || !r.task_assigned_to).length;
            const hasPills = dirtyCount > 0 || pendingInspCount > 0 || arrivalCritCount > 0 || unassignedCount > 0 || floors.length > 0 || selectedRows.size > 0;
            if (!hasPills) return null;
            return (
              <div className="flex flex-wrap items-center gap-2 mb-6">
                {dirtyCount > 0 && (
                  <button onClick={selectAllDirty} className="px-3 py-1.5 rounded-full bg-red-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-red-700 transition shadow-lg shadow-red-500/10 flex items-center gap-1.5">
                    Select All Dirty <span className="bg-white/20 px-1.5 py-0.5 rounded-full text-[9px]">{dirtyCount}</span>
                  </button>
                )}
                {pendingInspCount > 0 && (
                  <button onClick={selectAllPendingInspection} className="px-3 py-1.5 rounded-full bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition shadow-lg shadow-blue-500/10 flex items-center gap-1.5">
                    Select Pending Inspection <span className="bg-white/20 px-1.5 py-0.5 rounded-full text-[9px]">{pendingInspCount}</span>
                  </button>
                )}
                {arrivalCritCount > 0 && (
                  <button onClick={selectArrivalCritical} className="px-3 py-1.5 rounded-full bg-pink-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-pink-700 transition shadow-lg shadow-pink-500/10 flex items-center gap-1.5">
                    Select Arrival Criticals <span className="bg-white/20 px-1.5 py-0.5 rounded-full text-[9px]">{arrivalCritCount}</span>
                  </button>
                )}
                {unassignedCount > 0 && (
                  <button onClick={selectUnassigned} className="px-3 py-1.5 rounded-full bg-amber-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-amber-700 transition shadow-lg shadow-amber-500/10 flex items-center gap-1.5">
                    Select Unassigned <span className="bg-white/20 px-1.5 py-0.5 rounded-full text-[9px]">{unassignedCount}</span>
                  </button>
                )}
                {floors.length > 0 && (
                  <select
                    defaultValue=""
                    onChange={(e) => { if (e.target.value) { selectFloor(parseInt(e.target.value)); e.target.value = ""; } }}
                    className="appearance-none px-3 py-1.5 rounded-full bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 text-[10px] font-black uppercase tracking-widest cursor-pointer focus:outline-none focus:border-indigo-500/60 hover:bg-indigo-600/30 transition"
                  >
                    <option value="" disabled>Select by Floor ▾</option>
                    {floors.map(f => <option key={f} value={f.toString()}>Floor {f}</option>)}
                  </select>
                )}
                {selectedRows.size > 0 && (
                  <button onClick={() => setSelectedRows(new Set())} className="px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-slate-400 text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition flex items-center gap-1">
                    Clear Selection <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })()}

          {/* Bulk Action Toolbar */}
          {selectedRows.size > 0 && (
            <div className="mb-6 bg-[#1a1c1e] border border-blue-500/30 rounded-2xl p-4 flex flex-wrap items-center gap-4 animate-in slide-in-from-top duration-300 shadow-2xl shadow-blue-500/10">
              <div className="flex items-center gap-3 pr-4 border-r border-white/10">
                <div className="w-10 h-10 rounded-xl bg-blue-600/20 flex items-center justify-center text-blue-400 font-black">
                  {selectedRows.size}
                </div>
                <div className="text-xs font-black uppercase tracking-widest text-slate-100">Rooms Selected</div>
              </div>
              
              <div className="flex items-center gap-2">
                <select 
                  value={bulkAssignStaff || ""} 
                  onChange={e => setBulkAssignStaff(e.target.value || null)}
                  className="appearance-none px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-[10px] font-black text-slate-300 focus:outline-none focus:border-blue-500/60"
                >
                  <option value="">Select staff...</option>
                  {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button onClick={handleBulkAssign} disabled={bulkLoading || !bulkAssignStaff} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-wider rounded-xl transition disabled:opacity-50">Assign Staff</button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button onClick={handleBulkStart} disabled={bulkLoading} className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-[10px] font-black uppercase tracking-wider rounded-xl transition flex items-center gap-2">
                  <Play className="w-3.5 h-3.5" /> Start Cleaning
                </button>
                <button onClick={handleBulkMarkClean} disabled={bulkLoading} className="px-4 py-2 bg-emerald-600/10 hover:bg-emerald-600/20 border border-emerald-500/30 text-emerald-500 text-[10px] font-black uppercase tracking-wider rounded-xl transition flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Mark Clean
                </button>
                <button onClick={handleBulkMarkInspected} disabled={bulkLoading} className="px-4 py-2 bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 text-[10px] font-black uppercase tracking-wider rounded-xl transition flex items-center gap-2">
                  <Eye className="w-3.5 h-3.5" /> Mark Inspected
                </button>
                <button onClick={handleBulkOOO} disabled={bulkLoading} className="px-4 py-2 bg-red-600/10 hover:bg-red-600/20 border border-red-500/30 text-red-500 text-[10px] font-black uppercase tracking-wider rounded-xl transition flex items-center gap-2">
                  <WrenchIcon className="w-3.5 h-3.5" /> Mark OOO
                </button>
              </div>
            </div>
          )}

          {/* Table of rooms */}
          <div className="bg-[#16181b] border border-white/[0.05] rounded-3xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-white/[0.02] border-b border-white/[0.05]">
                  <tr>
                    <th className="px-6 py-4 w-12 text-center">
                      <input 
                        type="checkbox" 
                        checked={allSelected} 
                        onChange={toggleAll}
                        className="w-4 h-4 rounded border-white/10 bg-white/5 text-indigo-600 focus:ring-indigo-500/40"
                      />
                    </th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Room</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Physical Status</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Arrival Impact</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Workflow</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Assigned</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">ETA / Est</th>
                    <th className="px-6 py-4 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {paginatedRooms.map(room => {
                    const isCrit = room.arrival_urgency === "CRITICAL" && room.arrival_blocked;
                    return (
                      <tr 
                        key={room.room_id}
                        onClick={() => setSelectedRoom(room)}
                        className={`group hover:bg-white/[0.02] transition-colors cursor-pointer ${selectedRows.has(room.room_id) ? "bg-indigo-500/5" : ""}`}
                      >
                        <td className="px-6 py-4 text-center" onClick={e => e.stopPropagation()}>
                          <input 
                            type="checkbox" 
                            checked={selectedRows.has(room.room_id)} 
                            onChange={() => toggleSelectRow(room.room_id)}
                            className="w-4 h-4 rounded border-white/10 bg-white/5 text-indigo-600 focus:ring-indigo-500/40"
                          />
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm border transition-all ${isCrit ? "bg-red-500/20 border-red-500/40 text-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]" : "bg-white/5 border-white/10 text-slate-300"}`}>
                              {room.room_number}
                            </div>
                            <div>
                              <div className="text-xs font-black text-slate-200 uppercase">{room.room_type_name}</div>
                              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Floor {room.floor}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4"><PhysicalStatusBadge room={room} /></td>
                        <td className="px-6 py-4"><ArrivalImpactCell room={room} /></td>
                        <td className="px-6 py-4"><WorkflowCell room={room} /></td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[10px] font-black">{room.assigned_staff_name?.charAt(0)}</div>
                            <span className="text-xs font-bold text-slate-300">{room.assigned_staff_name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {(() => {
                            const s = room.housekeeping_status;
                            if (s === "in_progress" && room.task_started_at) {
                              const remaining = Math.max(0, 30 - Math.round((Date.now() - new Date(room.task_started_at).getTime()) / 60000));
                              return <span className="text-xs font-black text-indigo-400">{remaining > 0 ? `${remaining}m left` : "OVERDUE"}</span>;
                            }
                            if (s === "dirty") return <span className="text-xs font-bold text-slate-500">~30m</span>;
                            return <span className="text-slate-700 text-xs">—</span>;
                          })()}
                        </td>
                        <td className="px-6 py-4 text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end">
                             {/* Contextual Actions - Solid Colors for High Visibility */}
                            {room.housekeeping_status === "dirty" && (
                              <button onClick={() => handleAction("start", room.room_id)} disabled={actionLoading} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition text-[11px] font-black uppercase tracking-widest flex items-center gap-2 shadow-lg shadow-blue-500/20">
                                <Play className="w-3.5 h-3.5 fill-white" /> Start Cleaning
                              </button>
                            )}
                            {room.housekeeping_status === "in_progress" && (
                              <button onClick={() => handleAction("clean", room.room_id)} disabled={actionLoading} className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition text-[11px] font-black uppercase tracking-widest flex items-center gap-2 shadow-lg shadow-emerald-500/20">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Mark Clean
                              </button>
                            )}
                            {(room.housekeeping_status === "clean" || room.housekeeping_status === "inspection") && (
                              <button onClick={() => handleAction("inspect", room.room_id)} disabled={actionLoading} className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition text-[11px] font-black uppercase tracking-widest flex items-center gap-2 shadow-lg shadow-indigo-500/20">
                                <Eye className="w-3.5 h-3.5" /> Mark Inspected
                              </button>
                            )}
                            {room.housekeeping_status === "ooo" && (
                              <button onClick={() => setResolveRoom(room)} disabled={actionLoading} className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition text-[11px] font-black uppercase tracking-widest flex items-center gap-2 shadow-lg shadow-orange-500/20">
                                <WrenchIcon className="w-3.5 h-3.5" /> Resolve
                              </button>
                            )}
                            {room.housekeeping_status === "inspected" && (
                              <button onClick={() => setInspectRoom(room)} disabled={actionLoading} className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition text-[11px] font-black uppercase tracking-widest flex items-center gap-2 shadow-lg shadow-orange-500/20">
                                <RefreshCw className="w-3.5 h-3.5" /> Reopen
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {paginatedRooms.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-20 text-center">
                        <div className="flex flex-col items-center">
                          <Sparkles className="w-12 h-12 text-slate-700 mb-4" />
                          <h3 className="text-slate-300 font-black uppercase text-sm tracking-widest">No rooms found</h3>
                          <p className="text-xs text-slate-600 mt-1">Adjust filters or search query</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-between px-6">
              <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Showing {paginatedRooms.length} of {filteredRooms.length} rooms</p>
              <div className="flex items-center gap-2">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => p - 1)}
                  className="p-2 bg-white/5 border border-white/10 rounded-xl text-slate-400 disabled:opacity-20 hover:bg-white/10"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="flex gap-1">
                   {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                     <button
                        key={p}
                        onClick={() => setCurrentPage(p)}
                        className={`w-8 h-8 rounded-xl text-[10px] font-black transition ${p === currentPage ? "bg-indigo-600 text-white shadow-lg" : "bg-white/5 text-slate-500 hover:bg-white/10"}`}
                     >
                       {p}
                     </button>
                   ))}
                </div>
                <button
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(p => p + 1)}
                  className="p-2 bg-white/5 border border-white/10 rounded-xl text-slate-400 disabled:opacity-20 hover:bg-white/10"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ───── RIGHT: Side Panels ───── */}
      {showArrivalPanel && (
        <div className="w-[320px] bg-[#16181b] border-l border-white/[0.05] flex flex-col h-full shrink-0 overflow-hidden text-white">
          <ArrivalDashboard rooms={rooms} onClose={() => setShowArrivalPanel(false)} />
        </div>
      )}
      {selectedRoom && (
        <div className="fixed inset-y-0 right-0 z-50 animate-in slide-in-from-right duration-300 shadow-2xl">
          <RoomDrawer
            room={selectedRoom}
            events={drawerEvents}
            onClose={() => setSelectedRoom(null)}
            onAction={handleAction}
            actionLoading={actionLoading}
          />
        </div>
      )}

      {/* ───── MODALS ───── */}
      {popupRoom && <StatusConfirmPopup room={popupRoom} loading={bulkLoading} onClose={() => setPopupRoom(null)} onConfirm={handlePopupConfirm} />}
      {inspectRoom && <InspectModal room={inspectRoom} loading={bulkLoading} onClose={() => setInspectRoom(null)} onConfirm={handleInspectConfirm} />}
      {resolveRoom && <ResolveModal room={resolveRoom} loading={bulkLoading} onClose={() => setResolveRoom(null)} onConfirm={handleResolveConfirm} />}
    </div>
  );
}
