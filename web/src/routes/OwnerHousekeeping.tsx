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
const StatusConfirmModal = ({
  room,
  onConfirm,
  onClose,
  loading
}: {
  room: HKRoom;
  onConfirm: (action: string) => void;
  onClose: () => void;
  loading: boolean;
}) => (
  <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
      <div className="bg-slate-800 px-6 py-4 flex justify-between items-center text-white">
        <h3 className="text-lg font-bold">Confirm Room Status</h3>
        <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition"><X className="w-5 h-5" /></button>
      </div>
      <div className="p-6">
        <div className="text-center mb-6">
          <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Room</p>
          <h2 className="text-3xl font-black text-slate-900">{room.room_number}</h2>
          {room.assigned_staff_name && (
            <p className="text-xs text-slate-400 mt-2 font-medium">Assigned to: {room.assigned_staff_name}</p>
          )}
        </div>

        <div className="space-y-3">
          <button
            onClick={() => onConfirm("vacant_clean")}
            disabled={loading}
            className="w-full flex items-center gap-4 px-5 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98] disabled:opacity-50"
          >
            <div className="p-2 bg-white/20 rounded-lg"><BedDouble className="w-5 h-5 flex-shrink-0" /></div>
            <div className="text-left">
              <p className="text-sm leading-tight">Vacant Clean</p>
              <p className="text-[10px] opacity-70 font-normal">Ready for check-in</p>
            </div>
          </button>

          <button
            onClick={() => onConfirm("occupied_clean")}
            disabled={loading}
            className="w-full flex items-center gap-4 px-5 py-4 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-bold transition-all shadow-lg shadow-indigo-500/20 active:scale-[0.98] disabled:opacity-50"
          >
            <div className="p-2 bg-white/20 rounded-lg"><User className="w-5 h-5 flex-shrink-0" /></div>
            <div className="text-left">
              <p className="text-sm leading-tight">Occupied Clean</p>
              <p className="text-[10px] opacity-70 font-normal">Mark as inspected</p>
            </div>
          </button>

          <button
            onClick={() => onConfirm("pause")}
            disabled={loading}
            className="w-full flex items-center gap-4 px-5 py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold transition-all shadow-lg shadow-orange-500/20 active:scale-[0.98] disabled:opacity-50"
          >
            <div className="p-2 bg-white/20 rounded-lg"><Clock className="w-5 h-5 flex-shrink-0" /></div>
            <div className="text-left">
              <p className="text-sm leading-tight">Pause Cleaning</p>
              <p className="text-[10px] opacity-70 font-normal">Mark room as pickup</p>
            </div>
          </button>
        </div>

        <button onClick={onClose} className="w-full mt-6 py-3 text-slate-500 font-bold hover:text-slate-700 transition">Cancel</button>
      </div>
    </div>
  </div>
);

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

const KPICard = ({ label, count, bg, icon, active, onClick }: {
  label: string; count: number; bg: string; icon: any;
  active?: boolean; onClick?: () => void;
}) => (
  <button onClick={onClick}
    className={`relative p-3 rounded-xl text-white shadow-md ${bg} flex justify-between items-center w-full text-left transition-all hover:scale-[1.02] hover:shadow-lg ${active ? "ring-2 ring-white ring-offset-2 ring-offset-gray-50 scale-[1.02]" : ""}`}
  >
    <div>
      <span className="block text-[10px] font-bold opacity-90 uppercase tracking-wider leading-tight">{label}</span>
      <span className="text-2xl font-extrabold mt-0.5 block leading-none">{count}</span>
    </div>
    <div className="bg-white/20 p-1.5 rounded-lg backdrop-blur-sm">{icon}</div>
  </button>
);

const PhysicalStatusBadge = ({ room }: { room: HKRoom }) => {
  const base = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border shadow-sm whitespace-nowrap";
  const s = room.housekeeping_status;
  const ts = room.task_status;

  if (s === "dirty" && ts === "in_progress") {
    const elapsed = room.task_started_at
      ? Math.round((Date.now() - new Date(room.task_started_at).getTime()) / 60000)
      : null;
    return (
      <div className="flex items-center gap-1.5">
        <span className={`${base} bg-red-50 text-red-700 border-red-200`}>
          <div className="w-1.5 h-1.5 rounded-full bg-red-500" /> Dirty
        </span>
        <span className="text-[10px] text-blue-600 font-semibold">▸ Progress{elapsed != null ? ` ${elapsed}m` : ""}</span>
      </div>
    );
  }
  if (s === "dirty") return <span className={`${base} bg-red-50 text-red-700 border-red-200`}><div className="w-1.5 h-1.5 rounded-full bg-red-500" /> Dirty</span>;
  if (s === "in_progress") {
    const elapsed = room.task_started_at
      ? Math.round((Date.now() - new Date(room.task_started_at).getTime()) / 60000)
      : null;
    return <span className={`${base} bg-blue-50 text-blue-700 border-blue-200`}><Play className="w-3 h-3" /> Cleaning {elapsed != null ? `✓ ${String(elapsed).padStart(3, "0")}m` : ""}</span>;
  }
  if (s === "pickup") return <span className={`${base} bg-amber-50 text-amber-700 border-amber-200`}><Pause className="w-3 h-3" /> Paused</span>;
  if (s === "clean") return <span className={`${base} bg-emerald-50 text-emerald-700 border-emerald-200`}><CheckCircle2 className="w-3 h-3" /> Ready / Clean</span>;
  if (s === "inspected") return <span className={`${base} bg-blue-50 text-blue-700 border-blue-200`}><Eye className="w-3 h-3" /> Inspected</span>;
  if (s === "out_of_order") return <span className={`${base} bg-gray-100 text-gray-600 border-gray-300`}><WrenchIcon className="w-3 h-3" /> OOO</span>;
  if (ts === "inspection_pending") return <span className={`${base} bg-violet-50 text-violet-700 border-violet-200`}><Eye className="w-3 h-3" /> Inspection Pending</span>;
  return <span className={`${base} bg-gray-50 text-gray-500 border-gray-200`}>To Clean</span>;
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
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
      <div className="bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bed className="w-5 h-5 text-white/80" />
          <div>
            <div className="text-white font-bold text-lg">Room {room.room_number}</div>
            <div className="text-blue-200 text-xs">{room.room_type_name || "Standard"}</div>
          </div>
        </div>
        <button onClick={onClose} className="text-white/80 hover:text-white"><X className="w-5 h-5" /></button>
      </div>
      <div className="px-6 py-3 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center justify-between text-sm"><span className="text-gray-500">Assigned</span><span className="font-medium">{room.assigned_staff_name}</span></div>
      </div>
      <div className="px-6 pt-4 pb-2"><h3 className="font-bold text-gray-900 text-center">Confirm Room Status</h3></div>
      <div className="px-6 pb-4 space-y-2.5">
        <button onClick={() => onConfirm("dirty")} disabled={loading} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-sm transition disabled:opacity-50"><X className="w-5 h-5" />Mark Dirty (Reopen)</button>
        <button onClick={() => onConfirm("vacant_clean")} disabled={loading} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm transition disabled:opacity-50"><Bed className="w-5 h-5" />Vacant Clean</button>
        <button onClick={() => onConfirm("occupied_clean")} disabled={loading} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm transition disabled:opacity-50"><User className="w-5 h-5" />Occupied Clean</button>
        <button onClick={() => onConfirm("pause")} disabled={loading} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-400 hover:bg-amber-500 text-white font-bold text-sm transition disabled:opacity-50"><Pause className="w-5 h-5" />Pause</button>
        <button onClick={onClose} className="w-full py-3 rounded-xl bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold text-sm">Cancel</button>
      </div>
    </div>
  </div>
);

/* ─────── Arrival Dashboard Sidebar ─────── */
const ArrivalDashboard = ({ rooms, onClose }: { rooms: HKRoom[]; onClose: () => void }) => {
  const criticalRooms = rooms.filter(r => r.arrival_blocked && r.arrival_urgency && ["CRITICAL", "HIGH"].includes(r.arrival_urgency));
  const [tab, setTab] = useState<"all" | "urgency">("all");

  return (
    <div className="w-[320px] bg-white border-l border-gray-200 shadow-xl flex flex-col h-full shrink-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
        <h2 className="font-bold text-gray-900 text-base">Arrival Dashboard</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
      </div>

      {/* Tabs */}
      <div className="px-4 pt-3 flex gap-2">
        <button onClick={() => setTab("all")} className={`px-3 py-1.5 rounded-full text-xs font-bold transition ${tab === "all" ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>All Arrivals</button>
        <button onClick={() => setTab("urgency")} className={`px-3 py-1.5 rounded-full text-xs font-bold transition ${tab === "urgency" ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>Urgency</button>
      </div>

      {/* Critical badge */}
      {criticalRooms.length > 0 && (
        <div className="mx-4 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between">
          <span className="text-xs font-bold text-red-700">Arrival CRITICAL &lt; 30m</span>
          <span className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">{criticalRooms.length}</span>
        </div>
      )}

      {/* Room list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {criticalRooms.length === 0 && (
          <div className="text-center text-sm text-gray-400 py-8">No arrival-critical rooms</div>
        )}
        {criticalRooms.map(room => (
          <div key={room.room_id} className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-3 py-2 flex items-center justify-between border-b border-gray-100">
              <span className="font-bold text-sm text-gray-900">Room {room.room_number} — {room.room_type_name || "Standard"}</span>
            </div>
            <div className="px-3 py-2 space-y-1.5">
              <PhysicalStatusBadge room={room} />
              <div className="bg-red-50 border border-red-100 rounded-lg p-2 mt-1.5">
                <div className="text-[10px] font-bold text-red-700 uppercase">
                  Arrival {room.arrival_urgency}: in {room.arrival_needed_in_minutes}m
                </div>
                <div className="text-xs text-gray-700 mt-1">
                  <AlertTriangle className="w-3 h-3 inline text-amber-500 mr-1" />
                  Room needed urgently for <strong>{room.arrival_guest_name}</strong>'s arrival in {room.arrival_needed_in_minutes}m.
                </div>
                <div className="text-[10px] text-gray-500 mt-1">
                  📌 Booking: {room.arrival_booking_code} ▸ {room.arrival_guest_name}
                </div>
                <div className="text-[10px] text-gray-500">⏱ ETA To arrival: <strong>{room.arrival_needed_in_minutes}m</strong></div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Cleaning Checklist */}
      <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
        <h4 className="text-xs font-bold text-gray-600 uppercase mb-2">Cleaning Checklist:</h4>
        <div className="space-y-1.5">
          {["Change bedding", "Clean bathroom", "Restock minibar", "Vacuum carpet"].map(item => (
            <label key={item} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" className="rounded border-gray-300 text-blue-600 w-3.5 h-3.5" />
              {item}
            </label>
          ))}
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
}) => (
  <div className="w-[380px] bg-white border-l border-gray-200 shadow-xl flex flex-col h-full overflow-hidden">
    <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-5 py-4 flex items-center justify-between shrink-0">
      <div>
        <div className="text-white font-bold text-lg">Room {room.room_number}</div>
        <div className="text-gray-400 text-xs">{room.room_type_name || "Standard"} · Floor {room.floor || "—"}</div>
      </div>
      <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
    </div>

    <div className="flex-1 overflow-y-auto">
      {/* HK Status Section */}
      <div className="px-5 py-4 border-b border-gray-100 shrink-0">
        <div className="flex items-center justify-between mb-3"><span className="text-sm text-gray-500">HK Status</span><PhysicalStatusBadge room={room} /></div>
        <div className="flex items-center justify-between mb-3"><span className="text-sm text-gray-500">Assigned</span><span className="text-sm font-semibold">{room.assigned_staff_name}</span></div>
        {room.task_status && <div className="flex items-center justify-between"><span className="text-sm text-gray-500">Task</span><span className="text-sm font-semibold capitalize">{room.task_status.replace(/_/g, " ")}</span></div>}
      </div>

      {/* Arrival Alert Section */}
      {room.arrival_blocked && <ArrivalImpactCard room={room} />}

      {/* Actions Section */}
      <div className="px-5 py-4 border-b border-gray-100 shrink-0">
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Actions</h4>
        <div className="grid grid-cols-2 gap-2">
          {room.housekeeping_status === "dirty" && !room.task_status?.includes("in_progress") && (
            <ActionButton label="Start" icon={<Play className="w-3.5 h-3.5" />} cls="bg-blue-600 hover:bg-blue-700" onClick={() => onAction("start", room.room_id)} disabled={actionLoading} />
          )}
          {(room.task_status === "in_progress" || room.housekeeping_status === "in_progress") && (
            <ActionButton label="Complete" icon={<CheckCircle2 className="w-3.5 h-3.5" />} cls="bg-emerald-600 hover:bg-emerald-700" onClick={() => onAction("complete_popup", room.room_id)} disabled={actionLoading} />
          )}
          {room.housekeeping_status === "clean" && (
            <ActionButton label="Inspect" icon={<Eye className="w-3.5 h-3.5" />} cls="bg-violet-500 hover:bg-violet-600" onClick={() => onAction("inspect", room.room_id)} disabled={actionLoading} />
          )}
          {room.housekeeping_status === "inspected" && (
            <ActionButton label="Reopen Cleaning" icon={<RefreshCw className="w-3.5 h-3.5" />} cls="bg-amber-500 hover:bg-amber-600" onClick={() => onAction("reopen", room.room_id)} disabled={actionLoading} />
          )}
          {room.housekeeping_status === "out_of_order" && (
            <ActionButton label="Resolve" icon={<Wrench className="w-3.5 h-3.5" />} cls="bg-orange-600 hover:bg-orange-700" onClick={() => onAction("resolve", room.room_id)} disabled={actionLoading} />
          )}
        </div>
      </div>

      {/* Timeline Section */}
      <div className="px-5 py-4">
        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Timeline</h4>
        {events.length === 0 ? <p className="text-sm text-gray-400 text-center py-4">No events yet</p> : (
          <div className="space-y-3">
            {events.map(evt => (
              <div key={evt.id} className="flex gap-3">
                <div className="w-2 h-2 rounded-full bg-gray-300 mt-1.5 shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-gray-800">{evt.event_type?.replace(/_/g, " ") || `${evt.old_status} → ${evt.new_status}`}</div>
                  <div className="text-[10px] text-gray-400">{new Date(evt.changed_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                  {evt.notes && <div className="text-[10px] text-gray-500 mt-0.5">{evt.notes}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  </div>
);

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
    clean: rooms.filter(r => r.housekeeping_status === "clean" || r.housekeeping_status === "inspected").length,
    inspectionPending: rooms.filter(r => r.task_status === "inspection_pending").length,
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
      else if (statusFilter === "clean") result = result.filter(r => r.housekeeping_status === "clean" || r.housekeeping_status === "inspected");
      else if (statusFilter === "inspection") result = result.filter(r => r.task_status === "inspection_pending");
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
    if (action === "complete_popup") { setPopupRoom(room); return; }
    if (action === "inspect") { setInspectRoom(room); return; }
    if (action === "resolve") { setResolveRoom(room); return; }
    if (action === "reopen") {
      setActionLoading(true);
      try {
        const result = await supabase.rpc("hk_supervisor_override", {
          p_room_id: roomId,
          p_new_status: "dirty",
          p_reason: "Reopened by supervisor"
        });
        if (result?.error) alert("Error: " + result.error.message);
        else fetchBoard();
      } catch (err) { console.error(err); }
      finally { setActionLoading(false); }
      return;
    }

    setActionLoading(true);
    try {
      let result;
      if (action === "start" || action === "resume") {
        result = await supabase.rpc("hk_start_cleaning", { p_room_id: roomId });
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
      if (action === "vacant_clean") result = await supabase.rpc("hk_complete_cleaning", { p_room_id: popupRoom.room_id, p_final_status: "clean" });
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
      else { setSelectedRows(new Set()); setBulkAssignStaff(null); }
    } catch (err) { console.error(err); }
    finally { setBulkLoading(false); }
  };

  const handleBulkStart = async () => {
    if (selCount === 0) return;
    setBulkLoading(true);
    try {
      const { error } = await supabase.rpc("hk_bulk_start_cleaning", { p_room_ids: selectedIds });
      if (error) alert("Bulk Start Error: " + error.message);
      else setSelectedRows(new Set());
    } catch (err) { console.error(err); }
    finally { setBulkLoading(false); }
  };

  const handleBulkMarkClean = async () => {
    if (selCount === 0) return;
    setBulkLoading(true);
    try {
      const { error } = await supabase.rpc("hk_bulk_complete_cleaning", { p_room_ids: selectedIds, p_final_status: "clean" });
      if (error) alert("Bulk Clean Error: " + error.message);
      else setSelectedRows(new Set());
    } catch (err) { console.error(err); }
    finally { setBulkLoading(false); }
  };

  const handleBulkOOO = async () => {
    if (selCount === 0) return;
    setBulkLoading(true);
    try {
      const { error } = await supabase.rpc("hk_bulk_mark_out_of_order", { p_room_ids: selectedIds, p_reason: "Supervisor bulk action" });
      if (error) alert("Bulk OOO Error: " + error.message);
      else setSelectedRows(new Set());
    } catch (err) { console.error(err); }
    finally { setBulkLoading(false); }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading Housekeeping Board...</div>;

  return (
    <div className="min-h-screen bg-gray-50 font-sans flex">
      {/* ── Main Content ── */}
      <div className="flex-1 p-5 space-y-4 overflow-x-hidden">

        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Building2 className="w-6 h-6 text-indigo-500" /> Housekeeping Management
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">{rooms.length} rooms total · Real-time updates</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Auto-Priority toggle */}
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
              <span className="text-xs font-medium">Auto-Priority</span>
              <button onClick={() => setAutoPriority(!autoPriority)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${autoPriority ? "bg-blue-600" : "bg-gray-300"}`}
              ><span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition transform ${autoPriority ? "translate-x-4" : "translate-x-0.5"}`} /></button>
            </label>
            <button onClick={fetchBoard}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50 shadow-sm"
            ><RefreshCw className="w-4 h-4" /> Refresh</button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2.5">
          <KPICard label="Dirty Rooms" count={stats.dirty} bg="bg-gradient-to-br from-red-500 to-red-600" icon={<X className="w-4 h-4 text-white" />} active={statusFilter === "dirty"} onClick={() => setStatusFilter(statusFilter === "dirty" ? null : "dirty")} />
          <KPICard label="In Progress" count={stats.inProgress} bg="bg-gradient-to-br from-orange-400 to-orange-500" icon={<Play className="w-4 h-4 text-white" />} active={statusFilter === "in_progress"} onClick={() => setStatusFilter(statusFilter === "in_progress" ? null : "in_progress")} />
          <KPICard label="Ready / Clean" count={stats.clean} bg="bg-gradient-to-br from-emerald-500 to-emerald-600" icon={<CheckCircle2 className="w-4 h-4 text-white" />} active={statusFilter === "clean"} onClick={() => setStatusFilter(statusFilter === "clean" ? null : "clean")} />
          <KPICard label="Inspection Pending" count={stats.inspectionPending} bg="bg-gradient-to-br from-blue-400 to-blue-500" icon={<Eye className="w-4 h-4 text-white" />} active={statusFilter === "inspection"} onClick={() => setStatusFilter(statusFilter === "inspection" ? null : "inspection")} />
          <KPICard label="Arrival Criticals" count={stats.arrivalCritical} bg="bg-gradient-to-br from-rose-500 to-pink-600" icon={<AlertTriangle className="w-4 h-4 text-white" />} active={statusFilter === "arrival_urgent"} onClick={() => setStatusFilter(statusFilter === "arrival_urgent" ? null : "arrival_urgent")} />
          <KPICard label="Arrival CDOR" count={stats.arrivalCDOR} bg="bg-gradient-to-br from-slate-700 to-slate-800" icon={<Clock className="w-4 h-4 text-white" />} active={statusFilter === "arrival_cdor"} onClick={() => setStatusFilter(statusFilter === "arrival_cdor" ? null : "arrival_cdor")} />
          <KPICard label="Out of Order" count={stats.outOfOrder} bg="bg-gradient-to-br from-gray-500 to-gray-600" icon={<WrenchIcon className="w-4 h-4 text-white" />} active={statusFilter === "ooo"} onClick={() => setStatusFilter(statusFilter === "ooo" ? null : "ooo")} />
        </div>

        {/* Filter Bar */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200/60 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-gray-500">Zone:</label>
            <div className="relative">
              <select value={floorFilter || ""} onChange={e => setFloorFilter(e.target.value || null)} className="appearance-none bg-white border border-gray-200 text-gray-700 text-sm font-medium py-1.5 pl-2.5 pr-7 rounded-lg focus:outline-none focus:border-indigo-500 cursor-pointer">
                <option value="">All</option>
                {floors.map(f => <option key={f} value={f}>Floor {f}</option>)}
              </select>
              <ChevronDown className="w-3 h-3 text-gray-400 absolute right-2 top-2.5 pointer-events-none" />
            </div>

            <label className="text-xs font-medium text-gray-500 ml-2">Room Type:</label>
            <div className="relative">
              <select value={roomTypeFilter || ""} onChange={e => setRoomTypeFilter(e.target.value || null)} className="appearance-none bg-white border border-gray-200 text-gray-700 text-sm font-medium py-1.5 pl-2.5 pr-7 rounded-lg focus:outline-none focus:border-indigo-500 cursor-pointer">
                <option value="">All</option>
                {roomTypes.map(rt => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
              </select>
              <ChevronDown className="w-3 h-3 text-gray-400 absolute right-2 top-2.5 pointer-events-none" />
            </div>

            <label className="text-xs font-medium text-gray-500 ml-2">Status:</label>
            <div className="relative">
              <select value={statusFilter || ""} onChange={e => setStatusFilter(e.target.value || null)} className="appearance-none bg-white border border-gray-200 text-gray-700 text-sm font-medium py-1.5 pl-2.5 pr-7 rounded-lg focus:outline-none focus:border-indigo-500 cursor-pointer">
                <option value="">All</option>
                <option value="dirty">Dirty</option>
                <option value="in_progress">In Progress</option>
                <option value="clean">Clean</option>
                <option value="inspection">Inspection</option>
                <option value="ooo">Out of Order</option>
              </select>
              <ChevronDown className="w-3 h-3 text-gray-400 absolute right-2 top-2.5 pointer-events-none" />
            </div>

            <label className="text-xs font-medium text-gray-500 ml-2">Assigned To:</label>
            <div className="relative">
              <select value={assignedFilter || ""} onChange={e => setAssignedFilter(e.target.value || null)} className="appearance-none bg-white border border-gray-200 text-gray-700 text-sm font-medium py-1.5 pl-2.5 pr-7 rounded-lg focus:outline-none focus:border-indigo-500 cursor-pointer">
                <option value="">All</option>
                {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <ChevronDown className="w-3 h-3 text-gray-400 absolute right-2 top-2.5 pointer-events-none" />
            </div>

            <label className="text-xs font-medium text-gray-500 ml-2">Arrival Priority:</label>
            <div className="relative">
              <select value={arrivalFilter || ""} onChange={e => setArrivalFilter(e.target.value || null)} className="appearance-none bg-white border border-gray-200 text-gray-700 text-sm font-medium py-1.5 pl-2.5 pr-7 rounded-lg focus:outline-none focus:border-indigo-500 cursor-pointer">
                <option value="">All</option>
                <option value="blocked">Arrival Blocked</option>
              </select>
              <ChevronDown className="w-3 h-3 text-gray-400 absolute right-2 top-2.5 pointer-events-none" />
            </div>

            {/* Search */}
            <div className="relative ml-auto">
              <Search className="h-3.5 w-3.5 text-gray-400 absolute left-2.5 top-2.5" />
              <input type="text" placeholder="Filter..." value={search} onChange={e => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm w-32 focus:outline-none focus:border-indigo-500 bg-gray-50"
              />
            </div>

            {(search || statusFilter || roomTypeFilter || floorFilter || arrivalFilter || assignedFilter) && (
              <button onClick={() => { setSearch(""); setStatusFilter(null); setRoomTypeFilter(null); setFloorFilter(null); setArrivalFilter(null); setAssignedFilter(null); }}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-gray-500 hover:text-red-500 transition"
              ><X className="w-3 h-3" /> Clear</button>
            )}
          </div>
        </div>

        {/* Quick-Select Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={selectAllDirty} className="px-3 py-1.5 rounded-full bg-red-500 text-white text-xs font-bold hover:bg-red-600 transition shadow-sm">🔴 Select All Dirty</button>
          <button onClick={selectArrivalCritical} className="px-3 py-1.5 rounded-full bg-orange-500 text-white text-xs font-bold hover:bg-orange-600 transition shadow-sm">🔴 Select Arrival Critical</button>
          <button onClick={selectUnassigned} className="px-3 py-1.5 rounded-full border border-gray-300 bg-white text-gray-700 text-xs font-bold hover:bg-gray-50 transition shadow-sm">🟢 Select Unassigned</button>
          {floors.length > 0 && (
            <button onClick={() => selectFloor(floors[0])} className="px-3 py-1.5 rounded-full border border-gray-300 bg-white text-gray-700 text-xs font-bold hover:bg-gray-50 transition shadow-sm">🟢 Select Floor {floors[0]}</button>
          )}
          {selCount > 0 && (
            <button onClick={() => setSelectedRows(new Set())} className="px-3 py-1.5 rounded-full border border-gray-300 bg-white text-gray-600 text-xs font-bold hover:bg-gray-50 transition flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Clear Selection <X className="w-3 h-3" /></button>
          )}
        </div>

        {/* Bulk Action Toolbar (conditional) */}
        {selCount > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-2.5 flex flex-wrap items-center gap-3">
            <span className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
              <User className="w-4 h-4 text-gray-500" /> {selCount} Room{selCount > 1 ? "s" : ""} Selected
            </span>
            <div className="h-5 w-px bg-gray-200" />
            {/* Assign Staff */}
            <div className="flex items-center gap-1.5">
              <select value={bulkAssignStaff || ""} onChange={e => setBulkAssignStaff(e.target.value || null)}
                className="appearance-none bg-white border border-blue-300 text-blue-700 text-xs font-bold py-1.5 pl-2.5 pr-7 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer"
              >
                <option value="">Select staff...</option>
                {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button onClick={handleBulkAssign} disabled={bulkLoading || !bulkAssignStaff}
                className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition disabled:opacity-50 flex items-center gap-1 shadow-sm"
              ><User className="w-3 h-3" /> Assign Staff</button>
            </div>
            <button onClick={handleBulkStart} disabled={bulkLoading}
              className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-bold hover:bg-green-700 transition disabled:opacity-50 flex items-center gap-1 shadow-sm"
            ><Play className="w-3 h-3" /> Start Cleaning</button>
            <button onClick={handleBulkMarkClean} disabled={bulkLoading}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600 transition disabled:opacity-50 flex items-center gap-1 shadow-sm"
            ><CheckCircle2 className="w-3 h-3" /> Mark Clean</button>
            <button onClick={handleBulkOOO} disabled={bulkLoading}
              className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-bold hover:bg-purple-700 transition disabled:opacity-50 flex items-center gap-1 shadow-sm"
            ><WrenchIcon className="w-3 h-3" /> Mark OOO</button>
          </div>
        )}

        {/* ── Table ── */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-3 w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-gray-300 text-blue-600 w-3.5 h-3.5" /></th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Room</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Physical Status</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Arrival Impact</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Workflow</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Assigned</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">ETA</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {paginatedRooms.map(room => {
                  const isCrit = room.arrival_urgency === "CRITICAL" && room.arrival_blocked;
                  return (
                    <tr key={room.room_id}
                      className={`hover:bg-blue-50/30 transition cursor-pointer group ${isCrit ? "bg-red-50/40 border-l-4 border-l-red-400" : ""}`}
                      onClick={() => setSelectedRoom(room)}
                    >
                      <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedRows.has(room.room_id)} onChange={() => toggleSelectRow(room.room_id)} className="rounded border-gray-300 text-blue-600 w-3.5 h-3.5" />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <div className="h-9 w-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 font-bold text-sm">{room.room_number}</div>
                          <div>
                            <div className="text-sm font-bold text-gray-900">{room.room_number} {room.room_type_name || ""}</div>
                            {room.arrival_booking_code && <div className="text-[10px] text-gray-400 flex items-center gap-1">📌 Booking: {room.arrival_booking_code}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap"><PhysicalStatusBadge room={room} /></td>
                      <td className="px-4 py-3 whitespace-nowrap"><ArrivalImpactCell room={room} /></td>
                      <td className="px-4 py-3 whitespace-nowrap"><WorkflowCell room={room} /></td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-600 text-xs font-bold">{room.assigned_staff_name.charAt(0)}</div>
                          <span className="text-sm text-gray-700 font-medium truncate max-w-[100px]">{room.assigned_staff_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {(() => {
                          const s = room.housekeeping_status;
                          // Only in_progress rooms have meaningful ETA
                          if (s === "in_progress" && room.task_started_at) {
                            const startedAt = new Date(room.task_started_at).getTime();
                            const elapsed = Math.round((Date.now() - startedAt) / 60000);
                            const estDuration = 30; // default cleaning estimate in minutes
                            const remaining = Math.max(0, estDuration - elapsed);
                            if (room.task_eta) {
                              return <span className="text-sm text-gray-700 font-medium">{new Date(room.task_eta).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>;
                            }
                            return <span className="text-sm font-semibold text-blue-600">{remaining > 0 ? `${remaining}m remaining` : "Due now"}</span>;
                          }
                          if (s === "dirty") return <span className="text-xs text-gray-400">~30m</span>;
                          // clean, inspected, pickup, out_of_order → no ETA
                          return <span className="text-gray-300">—</span>;
                        })()}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5 justify-end">
                          {isCrit && room.housekeeping_status !== "in_progress" && (
                            <button onClick={() => handleAction("start", room.room_id)} disabled={actionLoading}
                              className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-red-500 to-orange-500 text-white text-xs font-bold hover:from-red-600 hover:to-orange-600 transition flex items-center gap-1 disabled:opacity-50 shadow-sm"
                            ><Sparkles className="w-3 h-3" /> Expedite Cleaning</button>
                          )}

                          {/* Operational Lifecycle Buttons */}
                          {room.housekeeping_status === "dirty" && (
                            <button onClick={() => handleAction("start", room.room_id)} disabled={actionLoading}
                              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition flex items-center gap-1 disabled:opacity-50"
                            ><Play className="w-3 h-3" /> Start</button>
                          )}

                          {room.housekeeping_status === "pickup" && (
                            <button onClick={() => handleAction("resume", room.room_id)} disabled={actionLoading}
                              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition flex items-center gap-1 disabled:opacity-50"
                            ><Play className="w-3 h-3" /> Resume</button>
                          )}

                          {room.housekeeping_status === "in_progress" && (
                            <button onClick={() => handleAction("complete_popup", room.room_id)} disabled={actionLoading}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition flex items-center gap-1 disabled:opacity-50"
                            ><CheckCircle2 className="w-3 h-3" /> Complete</button>
                          )}

                          {room.housekeeping_status === "clean" && (
                            <button onClick={() => handleAction("inspect", room.room_id)} disabled={actionLoading}
                              className="px-3 py-1.5 rounded-lg bg-violet-500 text-white text-xs font-bold hover:bg-violet-600 transition flex items-center gap-1 disabled:opacity-50"
                            ><Eye className="w-3 h-3" /> Inspect</button>
                          )}

                          {room.housekeeping_status === "inspected" && (
                            <button onClick={() => handleAction("reopen", room.room_id)} disabled={actionLoading}
                              className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 transition flex items-center gap-1 disabled:opacity-50"
                            ><RefreshCw className="w-3 h-3" /> Reopen</button>
                          )}

                          {room.housekeeping_status === "out_of_order" && (
                            <button onClick={() => handleAction("resolve", room.room_id)} disabled={actionLoading}
                              className="px-3 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-bold hover:bg-orange-700 transition flex items-center gap-1 disabled:opacity-50"
                            ><Wrench className="w-3 h-3" /> Resolve</button>
                          )}

                          <button onClick={() => setSelectedRoom(room)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"><ChevronRight className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {paginatedRooms.length === 0 && (
                  <tr><td colSpan={8} className="px-5 py-12 text-center text-gray-400 text-sm">No rooms match the current filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/50">
            <span className="text-xs text-gray-500">
              Showing <strong>{filteredRooms.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}</strong> to <strong>{Math.min(currentPage * pageSize, filteredRooms.length)}</strong> of <strong>{filteredRooms.length}</strong> ♡
            </span>
            <div className="flex gap-1">
              <button onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1}
                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              ><ChevronLeft className="w-3 h-3 inline" /></button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let p = i + 1;
                if (totalPages > 5 && currentPage > 3) p = currentPage - 2 + i;
                if (p > totalPages) return null;
                return (
                  <button key={p} onClick={() => setCurrentPage(p)}
                    className={`w-8 h-8 rounded-lg text-xs font-bold transition ${p === currentPage ? "bg-blue-600 text-white shadow-sm" : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"}`}
                  >{p}</button>
                );
              })}
              {totalPages > 5 && currentPage < totalPages - 2 && <span className="px-1 text-gray-400">…</span>}
              <button onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages || totalPages === 0}
                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              ><ChevronRight className="w-3 h-3 inline" /></button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: Arrival Dashboard or Room Drawer ── */}
      {selectedRoom ? (
        <RoomDrawer room={selectedRoom} events={drawerEvents} onClose={() => setSelectedRoom(null)} onAction={handleAction} actionLoading={actionLoading} />
      ) : showArrivalPanel ? (
        <ArrivalDashboard rooms={rooms} onClose={() => setShowArrivalPanel(false)} />
      ) : null}

      {/* ── Status Confirmation Modal ── */}
      {(() => {
        if (popupRoom) return <StatusConfirmModal room={popupRoom} onConfirm={handlePopupConfirm} onClose={() => setPopupRoom(null)} loading={bulkLoading} />;
        if (inspectRoom) return <InspectModal room={inspectRoom} onConfirm={handleInspectConfirm} onClose={() => setInspectRoom(null)} loading={bulkLoading} />;
        if (resolveRoom) return <ResolveModal room={resolveRoom} onConfirm={handleResolveConfirm} onClose={() => setResolveRoom(null)} loading={bulkLoading} />;
        return null;
      })()}
    </div>
  );
}
