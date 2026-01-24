import {
  useEffect,
  useState,
  useMemo,
  useCallback,
} from "react";
import { useSearchParams, Link } from "react-router-dom";
import {
  listTickets,
  listOrders,
  listRooms,
  updateTicket,
  unblockTask,
  reassignTask,
  rejectSlaException,
  rejectSupervisorApproval,
  grantSlaException,
  IS_SUPABASE_FUNCTIONS,
} from "../lib/api";
import { connectEvents } from "../lib/sse";
import { supabase } from "../lib/supabase";
import { StaffPicker } from "../components/StaffPicker";
import TicketDetailsDrawer from "../components/TicketDetailsDrawer";
import SupervisorDecisionDrawer from "../components/SupervisorDecisionDrawer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TicketStatus = "Requested" | "Accepted" | "InProgress" | "Done" | "Paused";
type TicketPriority = "low" | "normal" | "high" | "urgent" | string;

type Ticket = {
  id: string;
  service_key: string;
  room: string;
  room_number?: string;
  title?: string;
  booking?: string;
  status: TicketStatus;
  created_at: string;
  accepted_at?: string;
  started_at?: string;
  done_at?: string;
  sla_minutes: number;
  sla_deadline?: string | null;
  is_overdue?: boolean;
  priority?: TicketPriority;
  mins_remaining?: number | null;
  assignee_name?: string;
  assignee_id?: string;
  reason_code?: string;
  needs_supervisor_action?: boolean;
  supervisor_reason_code?: string;
  supervisor_request_type?: string;
  supervisor_requested_at?: string;
  sla_state?: string;
};

type Order = {
  id: string;
  status: string;
  created_at: string;
  items?: any[];
  room?: string;
  booking?: string;
};

type StaffMember = {
  id: string;
  user_id: string;
  role: 'STAFF' | 'MANAGER' | 'OWNER' | string;
  zone?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  full_name?: string;
  phone_number?: string;
};

function mapBackendStatusToUi(rawStatus: unknown): TicketStatus {
  const s = String(rawStatus ?? "").toLowerCase();
  switch (s) {
    case "new":
    case "requested":
    case "unassigned":
      return "Requested";
    case "accepted":
      return "Accepted";
    case "in_progress":
    case "in-progress":
    case "in progress":
      return "InProgress";
    case "paused":
    case "blocked":
    case "supervisor_requested": // Map supervisor requests to Paused visually if needed, or InProgress
      return "Paused";
    case "resolved":
    case "closed":
    case "done":
    case "completed":
    case "cancelled":
      return "Done";
    default:
      return "Requested";
  }
}

function normalizeTicket(raw: any): Ticket {
  const id = String(raw?.id ?? "");
  const service_key = String(
    raw?.service_key ?? raw?.title ?? raw?.key ?? raw?.service ?? "service"
  ).trim();
  const room = String(
    raw?.location_label ?? raw?.room_number ?? raw?.room?.number ?? raw?.room ?? raw?.roomNo ?? raw?.unit ?? "-"
  ).trim();
  const created_at =
    raw?.created_at ??
    raw?.inserted_at ??
    raw?.created ??
    new Date().toISOString();
  const status = mapBackendStatusToUi(raw?.status);
  const sla_minutes =
    Number(
      raw?.sla_minutes ??
      raw?.sla_minutes_snapshot ??
      raw?.sla ??
      raw?.sla_mins
    ) || 0;

  const assignee_name = raw?.assignee?.name ?? raw?.assignee_name ?? undefined;
  const assignee_id = raw?.assignee?.id ?? raw?.assignee_id ?? raw?.current_assignee_id ?? undefined;

  const mins_remaining = typeof raw?.mins_remaining === "number" ? raw.mins_remaining :
    typeof raw?.sla_remaining_seconds === "number" ? Math.floor(raw.sla_remaining_seconds / 60) :
      null;

  return {
    id,
    service_key,
    room,
    booking: raw?.booking ?? raw?.stay_code,
    status,
    created_at,
    sla_minutes,
    is_overdue: typeof raw?.is_overdue === "boolean" ? raw.is_overdue : (mins_remaining !== null && mins_remaining < 0),
    assignee_name,
    assignee_id,
    priority: raw?.priority,
    mins_remaining,
    reason_code: raw?.reason_code ?? raw?.primary_reason_code,
    needs_supervisor_action: raw?.needs_supervisor_action,
    supervisor_reason_code: raw?.supervisor_reason_code,
    supervisor_request_type: raw?.supervisor_request_type,
    supervisor_requested_at: raw?.supervisor_requested_at,
    sla_state: raw?.sla_state,
  };
}

function useEffectiveHotelId() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSlug = searchParams.get("slug");
  const [hotelId, setHotelId] = useState<string | null>(null);
  const [hotelSlug, setHotelSlug] = useState<string | null>(urlSlug);
  const [hotelName, setHotelName] = useState<string | null>(null);
  const [initialised, setInitialised] = useState(false);
  const [debugMsg, setDebugMsg] = useState<string>("");

  useEffect(() => {
    (async () => {
      try {
        // If slug is in URL, look up hotel by slug
        if (urlSlug) {
          const { data: hotel } = await supabase
            .from("hotels")
            .select("id, slug, name")
            .eq("slug", urlSlug)
            .single();
          if (hotel) {
            setHotelId(hotel.id);
            setHotelSlug(hotel.slug);
            setHotelName(hotel.name);
          } else {
            setDebugMsg("Hotel not found");
          }
          setInitialised(true);
          return;
        }

        // No slug in URL - look up user's hotel
        const { data: userRes } = await supabase.auth.getUser();
        if (!userRes?.user) {
          setDebugMsg("No user logged in");
          setInitialised(true);
          return;
        }
        const { data: memberData } = await supabase
          .from("hotel_members")
          .select("hotel_id, hotels(slug, name)")
          .eq("user_id", userRes.user.id)
          .limit(1)
          .maybeSingle();

        if (memberData?.hotel_id) {
          setHotelId(memberData.hotel_id);
          const h = (memberData.hotels as any);
          if (h?.slug) {
            setHotelSlug(h.slug);
            setHotelName(h.name);
            const next = new URLSearchParams(searchParams);
            next.set("slug", h.slug);
            setSearchParams(next, { replace: true });
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setInitialised(true);
      }
    })();
  }, [urlSlug]);

  return { hotelId, hotelSlug, hotelName, initialised, debugMsg };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

// Simple Comment Modal Component
function CommentModal({
  isOpen,
  title,
  onSubmit,
  onClose
}: {
  isOpen: boolean;
  title: string;
  onSubmit: (comment: string) => void;
  onClose: () => void
}) {
  const [comment, setComment] = useState("");

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4">
      <div className="bg-[#1A1C25] border border-white/10 rounded-xl max-w-sm w-full p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-4">{title}</h3>
        <textarea
          autoFocus
          className="w-full bg-[#111218] border border-white/10 rounded-lg p-3 text-white text-sm focus:outline-none focus:border-blue-500 min-h-[100px]"
          placeholder="Enter reason (optional)..."
          value={comment}
          onChange={e => setComment(e.target.value)}
        />
        <div className="flex justify-end gap-3 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white text-sm">Cancel</button>
          <button
            onClick={() => {
              onSubmit(comment);
              setComment("");
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium">
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBlock({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick?: () => void;
}) {
  // Determine accent color based on label
  const getAccentColor = () => {
    switch (label) {
      case 'New': return 'bg-blue-500';
      case 'In Progress': return 'bg-green-500';
      case 'Blocked': return 'bg-red-500';
      case 'At Risk': return 'bg-amber-500';
      default: return 'bg-gray-500';
    }
  };

  const getRingColor = () => {
    switch (label) {
      case 'New': return 'ring-blue-500/50';
      case 'In Progress': return 'ring-green-500/50';
      case 'Blocked': return 'ring-red-500/50';
      case 'At Risk': return 'ring-amber-500/50';
      default: return 'ring-gray-500/50';
    }
  };

  return (
    <div
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center rounded-xl px-4 py-3 min-w-[100px] transition-all cursor-pointer overflow-hidden
        ${active ? `bg-[#1A1C25] ring-1 ${getRingColor()} scale-105` : "bg-[#111218] hover:bg-[#1A1C25] border border-white/5"}
      `}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-2xl font-light text-white tracking-tight`}>{count}</span>
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</h3>
        {active && <div className={`w-1.5 h-1.5 rounded-full ${getAccentColor()}`}></div>}
      </div>
      {/* Colored underline accent */}
      <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${getAccentColor()}`}></div>
    </div>
  );
}

function DecisionCard({ ticket, onAction, onClick }: { ticket: Ticket; onAction: (t: Ticket, action: string) => void; onClick: () => void }) {
  // Distinguish between Supervisor Approval request and SLA Exception request
  const isSupervisorReq = ticket.supervisor_request_type === 'SUPERVISOR_REQUESTED' ||
    (!ticket.supervisor_request_type && ticket.supervisor_reason_code === 'supervisor_approval') ||
    (ticket.status === 'Paused' && ticket.reason_code === 'supervisor_approval');

  const isSlaExceptionReq = ticket.supervisor_request_type === 'SLA_EXCEPTION_REQUESTED';

  // Use supervisor_reason_code if available, else check block reason
  const reason = ticket.supervisor_reason_code === 'supervisor_approval' || (ticket.status === 'Paused' && ticket.reason_code === 'supervisor_approval')
    ? 'Supervisor Approval'
    : (ticket.supervisor_reason_code || ticket.reason_code || 'Attention Needed');

  // Helper to safely format room number
  const room = String(ticket.room || ticket.room_number || '-').trim();

  // Visual styling based on request type
  const borderColor = isSlaExceptionReq ? 'border-blue-900/30 hover:border-blue-900/50' : 'border-amber-900/30 hover:border-amber-900/50';
  const leftBarColor = isSlaExceptionReq ? 'bg-blue-500' : 'bg-amber-500';
  const reasonBgColor = isSlaExceptionReq ? 'bg-blue-950/30 border-blue-900/20' : 'bg-amber-950/30 border-amber-900/20';
  const reasonTextColor = isSlaExceptionReq ? 'text-blue-200' : 'text-amber-200';
  const reasonIcon = isSlaExceptionReq ? '⏱️' : '🛑';

  return (
    <div
      onClick={onClick}
      className={`bg-[#111218] border ${borderColor} rounded-lg p-4 relative group transition-all cursor-pointer`}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${leftBarColor} rounded-l-lg`}></div>

      <div className="flex justify-between items-start mb-3">
        <div className="flex gap-4 items-center">
          <span className="text-2xl font-light text-white w-12">{room}</span>
          <div>
            <div className="text-sm font-medium text-white mb-1">{(ticket.service_key || ticket.title || 'Task').replace(/_/g, ' ')}</div>
            <div className="flex items-center gap-2">
              {ticket.assignee_name && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className="w-4 h-4 rounded-full bg-gray-800 flex items-center justify-center text-[8px]">👤</span>
                  {ticket.assignee_name}
                </div>
              )}
              {isSupervisorReq && (
                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[10px] uppercase font-bold tracking-wider border border-amber-500/20">
                  Supervisor Approval Requested
                </span>
              )}
              {isSlaExceptionReq && (
                <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 text-[10px] uppercase font-bold tracking-wider border border-blue-500/20">
                  SLA Exception Requested
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="flex items-center gap-1.5 justify-end mb-1">
            <span className={`w-2 h-2 rounded-full ${ticket.sla_state === 'BREACHED' || ticket.is_overdue ? 'bg-red-500' :
              ticket.sla_state === 'PAUSED' || ticket.sla_state === 'EXEMPTED' ? 'bg-yellow-500' :
                'bg-amber-500 animate-pulse'
              }`}></span>
            <span className={`text-sm font-mono font-bold ${ticket.sla_state === 'BREACHED' || ticket.is_overdue ? 'text-red-400' :
              ticket.sla_state === 'PAUSED' || ticket.sla_state === 'EXEMPTED' ? 'text-yellow-400' :
                'text-amber-400'
              }`}>{Math.abs(ticket.mins_remaining || 0)}m</span>
          </div>
          <div className={`text-[10px] font-bold uppercase tracking-wider ${ticket.sla_state === 'EXEMPTED' ? 'text-green-500' :
            ticket.sla_state === 'BREACHED' || ticket.is_overdue ? 'text-red-500' :
              ticket.sla_state === 'PAUSED' ? 'text-yellow-500' :
                'text-amber-500'
            }`}>{
              ticket.sla_state === 'EXEMPTED' ? 'SLA Exempted' :
                ticket.sla_state === 'BREACHED' || ticket.is_overdue ? 'SLA Breached' :
                  ticket.sla_state === 'PAUSED' ? 'SLA Paused' :
                    'SLA Running'
            }</div>
        </div>
      </div>

      <div className={`ml-16 py-2 px-3 ${reasonBgColor} rounded border text-xs ${reasonTextColor} mb-4 flex gap-2 items-center`}>
        <span>{reasonIcon}</span>
        Reason: {reason}
      </div>

      <div className="flex justify-end gap-3 ml-16" onClick={e => e.stopPropagation()}>
        {isSupervisorReq ? (
          <>
            <button
              onClick={() => onAction(ticket, 'reject')}
              className="px-4 py-1.5 bg-[#1A1C25] border border-red-900/50 text-red-400 text-xs font-bold uppercase rounded hover:bg-red-900/20 transition-colors">
              Reject
            </button>
            <button
              onClick={() => onAction(ticket, 'approve')}
              className="px-4 py-1.5 bg-green-600 text-white text-xs font-bold uppercase rounded hover:bg-green-500 transition-colors">
              Approve
            </button>
            <button
              onClick={() => onAction(ticket, 'reassign')}
              className="px-4 py-1.5 bg-[#1A1C25] border border-gray-700 text-gray-300 text-xs font-bold uppercase rounded hover:bg-gray-800 transition-colors">
              Reassign
            </button>
            <button
              onClick={() => onAction(ticket, 'resolve')}
              className="px-4 py-1.5 bg-[#1A1C25] border border-gray-700 text-gray-300 text-xs font-bold uppercase rounded hover:bg-gray-800 transition-colors">
              Manage Ticket
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onAction(ticket, 'reject')}
              className="px-4 py-1.5 bg-[#1A1C25] border border-red-900/50 text-red-400 text-xs font-bold uppercase rounded hover:bg-red-900/20 transition-colors">
              Reject SLA Exception
            </button>
            <button
              onClick={() => onAction(ticket, 'exception')}
              className="px-4 py-1.5 bg-green-600 text-white text-xs font-bold uppercase rounded hover:bg-green-500 transition-colors">
              Grant SLA Exception
            </button>
            <button
              onClick={() => onAction(ticket, 'resolve')}
              className="px-4 py-1.5 bg-[#1A1C25] border border-gray-700 text-gray-300 text-xs font-bold uppercase rounded hover:bg-gray-800 transition-colors">
              Manage Ticket
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function OversightCard({ ticket, onAction, onClick }: { ticket: Ticket; onAction: (t: Ticket, action: string) => void; onClick: () => void }) {
  const isBlocked = ticket.status === 'Paused';

  // Use canonical At Risk definition: remaining <= min(30, 25% of target SLA)
  const targetSla = ticket.sla_minutes || 30;
  const riskThreshold = Math.min(30, targetSla * 0.25);
  const remaining = ticket.mins_remaining || 0;
  const isAtRisk = !isBlocked && !ticket.is_overdue && remaining > 0 && remaining <= riskThreshold && ticket.sla_state !== 'EXEMPTED';

  const statusColor = isBlocked ? 'text-red-400' : isAtRisk ? 'text-amber-400' : 'text-red-500';
  const borderColor = isBlocked ? 'border-red-900/30' : 'border-amber-900/30';
  const label = isBlocked ? 'Blocked' : ticket.is_overdue ? 'SLA Breached' : 'At Risk';
  const labelBg = isBlocked ? 'bg-red-950/50' : ticket.is_overdue ? 'bg-red-950/30' : 'bg-amber-950/30';

  return (
    <div
      onClick={onClick}
      className={`bg-[#111218] border ${borderColor} rounded-lg p-3 hover:bg-[#15161c] transition-colors group cursor-pointer`}
    >
      <div className="flex items-center gap-4">
        <div className="text-xl font-light text-gray-300 w-10 text-center">{ticket.room}</div>

        <div className="flex-1 min-w-0">
          <div className="flex gap-1 mb-1">
            {/* Compact Tags */}
            <span className="px-1.5 py-0.5 bg-[#1A1C25] rounded text-[10px] text-blue-300 font-mono border border-blue-900/30">
              {ticket.id.slice(0, 4)}
            </span>
          </div>
          <div className="text-xs text-gray-500 truncate">{ticket.service_key}</div>
          {ticket.assignee_name && (
            <div className="text-[10px] text-gray-600 mt-0.5">{ticket.assignee_name}</div>
          )}
        </div>

        <div className="text-right flex flex-col items-end gap-1">
          <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${labelBg} ${statusColor} border border-white/5`}>
            {label}
          </div>
        </div>
      </div>

      {/* Action Buttons - Right aligned */}
      <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-white/5">
        {isAtRisk ? (
          // AT RISK buttons: Reassign (primary), Prioritize, Manage
          <>
            <button
              onClick={(e) => { e.stopPropagation(); onAction(ticket, 'reassign'); }}
              className="px-4 py-1.5 bg-amber-500 text-black text-xs font-bold uppercase rounded hover:bg-amber-400 transition-colors"
            >
              Reassign
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onAction(ticket, 'prioritize'); }}
              className="px-4 py-1.5 bg-[#1A1C25] border border-amber-900/50 text-amber-400 text-xs font-bold uppercase rounded hover:bg-amber-900/20 transition-colors"
            >
              Prioritize
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onAction(ticket, 'resolve'); }}
              className="px-4 py-1.5 bg-[#1A1C25] border border-gray-700 text-gray-300 text-xs font-bold uppercase rounded hover:bg-gray-800 transition-colors"
            >
              Manage
            </button>
          </>
        ) : isBlocked ? (
          // BLOCKED buttons: Manage (primary), Reassign
          <>
            <button
              onClick={(e) => { e.stopPropagation(); onAction(ticket, 'resolve'); }}
              className="px-4 py-1.5 bg-red-500/20 border border-red-900/50 text-red-400 text-xs font-bold uppercase rounded hover:bg-red-900/30 transition-colors"
            >
              Manage Ticket
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onAction(ticket, 'reassign'); }}
              className="px-4 py-1.5 bg-[#1A1C25] border border-gray-700 text-gray-300 text-xs font-bold uppercase rounded hover:bg-gray-800 transition-colors"
            >
              Reassign
            </button>
          </>
        ) : (
          // Breached or other: Reassign, Manage
          <>
            <button
              onClick={(e) => { e.stopPropagation(); onAction(ticket, 'reassign'); }}
              className="px-4 py-1.5 bg-[#1A1C25] border border-gray-700 text-gray-300 text-xs font-bold uppercase rounded hover:bg-gray-800 transition-colors"
            >
              Reassign
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onAction(ticket, 'resolve'); }}
              className="px-4 py-1.5 bg-[#1A1C25] border border-gray-700 text-gray-300 text-xs font-bold uppercase rounded hover:bg-gray-800 transition-colors"
            >
              Manage
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// MAPPING
const BLOCK_REASON_LABELS: Record<string, string> = {
  guest_inside: "Guest Inside",
  room_locked: "Room Locked",
  supplies_unavailable: "Supplies Unavailable",
  waiting_maintenance: "Waiting for Maintenance",
  supervisor_approval: "Supervisor Approval",
  shift_ended: "Shift Ended",
  something_else: "Other",
  GUEST_REQUESTED_LATER: "Guest Requested Later"
};

function ContextTaskCard({ ticket, onClick, onAction, filterType, assigneeName }: { ticket: Ticket; onClick: () => void; onAction: (t: Ticket, action: string) => void; filterType?: string; assigneeName?: string }) {
  const isNew = ticket.status === 'Requested';
  const isAtRisk = filterType === 'AtRisk';

  const isBlocked = ticket.status === 'Paused';
  // Reason text for blocked tickets - use readable label
  let reasonText = null;
  if (isBlocked) {
    const code = ticket.supervisor_reason_code || ticket.reason_code || 'Blocked';
    reasonText = BLOCK_REASON_LABELS[code] || code.replace(/_/g, ' ');
  }

  // Use provided fallback name or ticket name
  const displayName = assigneeName || ticket.assignee_name || 'Unassigned';

  return (
    <div
      onClick={onClick}
      className={`p-3 rounded-lg bg-[#111218] border border-white/5 hover:bg-[#1A1C25] cursor-pointer transition-colors ${isBlocked ? 'border-red-500/20' : ''}`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full shrink-0 ${isAtRisk ? 'bg-amber-500' : isBlocked ? 'bg-red-500' : isNew ? 'bg-blue-500' : 'bg-green-500'}`}></div>
        <div className="text-lg font-light text-white w-14 text-center shrink-0 leading-none">{ticket.room}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-200 truncate">{ticket.service_key.replace(/_/g, ' ')}</div>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-[8px] text-gray-400">👤</span>
              <span className="text-xs text-gray-400 truncate max-w-[100px]">{displayName}</span>
            </div>
            {reasonText && (
              <div className="text-[10px] text-red-400 font-bold px-1.5 py-0.5 bg-red-950/40 rounded border border-red-900/40 whitespace-nowrap">
                {reasonText}
              </div>
            )}
          </div>
        </div>
        <div className="text-xs font-mono font-medium text-gray-500 shrink-0">{Math.floor(ticket.mins_remaining || 0)}m</div>
      </div>

      {/* Action Buttons - Context-aware */}
      <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-white/5">
        {isAtRisk ? (
          // AT RISK: Reassign (primary), Prioritize, Manage
          <>
            <button
              onClick={(e) => { e.stopPropagation(); onAction(ticket, 'reassign'); }}
              className="px-4 py-1.5 bg-amber-500 text-black text-xs font-bold uppercase rounded hover:bg-amber-400 transition-colors"
            >
              Reassign
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onAction(ticket, 'prioritize'); }}
              className="px-4 py-1.5 bg-[#1A1C25] border border-amber-900/50 text-amber-400 text-xs font-bold uppercase rounded hover:bg-amber-900/20 transition-colors"
            >
              Prioritize
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onAction(ticket, 'resolve'); }}
              className="px-4 py-1.5 bg-[#1A1C25] border border-gray-700 text-gray-300 text-xs font-bold uppercase rounded hover:bg-gray-800 transition-colors"
            >
              Manage
            </button>
          </>
        ) : (
          // NEW / IN PROGRESS: Reassign, Manage
          <>
            <button
              onClick={(e) => { e.stopPropagation(); onAction(ticket, 'reassign'); }}
              className="px-4 py-1.5 bg-[#1A1C25] border border-gray-700 text-gray-300 text-xs font-bold uppercase rounded hover:bg-gray-800 transition-colors"
            >
              Reassign
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onAction(ticket, 'resolve'); }}
              className="px-4 py-1.5 bg-[#1A1C25] border border-gray-700 text-gray-300 text-xs font-bold uppercase rounded hover:bg-gray-800 transition-colors"
            >
              Manage
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function OpsBoard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hotelId, hotelSlug, hotelName, initialised } = useEffectiveHotelId();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);

  // State
  const [filterStatus, setFilterStatus] = useState<"All" | "New" | "InProgress" | "Blocked" | "AtRisk">("All");
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null); // For Details Drawer

  // Modals
  const [showStaffPicker, setShowStaffPicker] = useState(false);
  const [reassignTicket, setReassignTicket] = useState<Ticket | null>(null);
  const [supervisorDrawerTicket, setSupervisorDrawerTicket] = useState<Ticket | null>(null); // For Supervisor Decision Drawer

  const [commentAction, setCommentAction] = useState<{
    isOpen: boolean;
    type: 'reject' | 'exception' | null;
    ticket: Ticket | null;
  }>({ isOpen: false, type: null, ticket: null });

  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connected');

  const refresh = useCallback(async () => {
    if (!hotelId) return;
    const [tRes, rRes] = await Promise.allSettled([
      listTickets(hotelId),
      listRooms(hotelId)
    ]);

    if (tRes.status === "fulfilled") {
      setTickets(((tRes.value as any).items || []).map(normalizeTicket));
    }
    if (rRes.status === "fulfilled") {
      const r = rRes.value as any[];
      if (r && r.length > 0) {
        setRooms(r.map(x => ({
          number: x.number ?? x.room_number ?? "000",
          floor: x.floor ?? x.floor_number ?? 1,
          id: x.id
        })));
      }
    }
    setLastUpdated(new Date());
  }, [hotelId]);

  useEffect(() => {
    if (hotelId) {
      refresh();
      const loadStaff = async () => {
        try {
          // 1. Fetch hotel_members
          const { data: members, error: mError } = await supabase
            .from('hotel_members')
            .select('*')
            .eq('hotel_id', hotelId)
            .eq('is_active', true);

          if (mError || !members) {
            console.error('Error fetching members', mError);
            return;
          }

          // 2. Fetch profiles manual join
          const userIds = members.map(m => m.user_id).filter(Boolean);
          let profiles: any[] = [];

          if (userIds.length > 0) {
            const { data: pData } = await supabase
              .from('profiles')
              .select('id, full_name, phone')
              .in('id', userIds);
            profiles = pData || [];
          }

          // 3. Merge
          const merged = members.map((m: any) => {
            const p = profiles.find(x => x.id === m.user_id);
            return {
              ...m,
              full_name: p?.full_name || 'Staff'
            };
          });

          setStaffMembers(merged);
        } catch (e) {
          console.error('loadStaff failed', e);
        }
      };
      loadStaff();
    }
  }, [hotelId, refresh]);

  useEffect(() => {
    if (initialised && hotelId) {
      refresh();

      let cleanupSSE: (() => void) | undefined;

      // Get token for SSE
      supabase.auth.getSession().then(({ data }) => {
        const token = data.session?.access_token;
        cleanupSSE = connectEvents({
          ticket_created: () => refresh(),
          ticket_updated: () => refresh(),
        }, {
          onStatusChange: (s) => setConnectionStatus(s),
          token
        });
      });

      const pollInterval = setInterval(refresh, 10000);

      return () => {
        if (cleanupSSE) cleanupSSE();
        clearInterval(pollInterval);
      };
    }
  }, [initialised, hotelId, refresh]);

  // CATEGORIZATION LOGIC
  const activeTickets = tickets.filter(t => t.status !== "Done");

  // Decision: Waiting for supervisor approval (Using computed flag from DB view)
  // Legacy fallback only applies if needs_supervisor_action is null/undefined (old data)
  // When needs_supervisor_action is explicitly false, that means decision was made - exclude it!
  const decisionTickets = activeTickets.filter(t =>
    t.needs_supervisor_action === true ||
    (t.needs_supervisor_action == null && t.status === 'Paused' && t.reason_code === 'supervisor_approval')
  );

  const decisionIds = new Set(decisionTickets.map(t => t.id));

  // AT RISK Definition (canonical):
  // - status IN (NEW, IN_PROGRESS, BLOCKED) → mapped to Requested, Accepted, InProgress, Paused
  // - NOT in decision queue (no pending supervisor request)
  // - NOT SLA exempted (sla_state !== 'EXEMPTED')
  // - NOT SLA breached (sla_state !== 'BREACHED', is_overdue !== true)
  // - sla_remaining_minutes > 0
  // - sla_remaining_minutes <= risk_threshold (min(30, 25% of target SLA))
  const atRiskTickets = activeTickets.filter(t => {
    // Exclude tickets in decision queue
    if (decisionIds.has(t.id)) return false;

    // Must be in active status
    const validStatus = ['Requested', 'Accepted', 'InProgress', 'Paused'].includes(t.status);
    if (!validStatus) return false;

    // Not exempted
    if (t.sla_state === 'EXEMPTED') return false;

    // Not breached (already too late)
    if (t.sla_state === 'BREACHED' || t.is_overdue) return false;

    // Must have positive remaining time
    const remaining = t.mins_remaining;
    if (remaining == null || remaining <= 0) return false;

    // Calculate risk threshold (server-side provided or fallback)
    const riskThreshold = (t as any).risk_threshold_minutes ?? Math.min(30, (t.sla_minutes || 30) * 0.25);

    // At risk if remaining is within threshold
    return remaining <= riskThreshold;
  });

  // Oversight combines: Blocked (Paused) OR At Risk
  // Excludes decision queue tickets
  const oversightTickets = activeTickets.filter(t => {
    if (decisionIds.has(t.id)) return false;
    // Blocked tickets (status = Paused, but not exempted/breached)
    if (t.status === 'Paused' && t.sla_state !== 'EXEMPTED' && t.sla_state !== 'BREACHED') return true;
    // At Risk tickets
    return atRiskTickets.some(ar => ar.id === t.id);
  });

  // Calculate staff load
  const staffLoad = useMemo(() => {
    const load: Record<string, number> = {};
    activeTickets.forEach(t => {
      if (t.assignee_id) {
        load[t.assignee_id] = (load[t.assignee_id] || 0) + 1;
      }
    });
    return staffMembers.map(s => ({
      ...s,
      taskCount: load[s.id] || 0
    })).sort((a, b) => b.taskCount - a.taskCount);
  }, [staffMembers, activeTickets]);

  // Calculate average time for active tickets (time since creation in minutes)
  const avgTimeMinutes = useMemo(() => {
    const inProgressTickets = activeTickets.filter(t =>
      t.status === 'InProgress' || t.status === 'Accepted'
    );
    if (inProgressTickets.length === 0) return 0;

    const now = Date.now();
    const totalMinutes = inProgressTickets.reduce((sum, t) => {
      const createdAt = new Date(t.created_at).getTime();
      const elapsedMs = now - createdAt;
      return sum + Math.floor(elapsedMs / 60000); // Convert to minutes
    }, 0);

    return Math.round(totalMinutes / inProgressTickets.length);
  }, [activeTickets]);

  // Context Tickets (Filtered View)
  // When a filter is active (New/InProgress) OR Room selected, show matching tickets
  // If "Blocked" is selected, oversight queue is already visible, but we can show full blocked list here too.
  const contextTickets = useMemo(() => {
    if (filterStatus === 'All' && !selectedRoom) return []; // Don't show anything contextually if no filter

    let list = activeTickets;
    if (selectedRoom) {
      list = list.filter(t => t.room === selectedRoom);
    }

    if (filterStatus === 'New') {
      list = list.filter(t => t.status === 'Requested');
    } else if (filterStatus === 'InProgress') {
      list = list.filter(t => t.status === 'InProgress' || t.status === 'Accepted');
    } else if (filterStatus === 'Blocked') {
      list = list.filter(t => t.status === 'Paused' && !decisionIds.has(t.id) && t.sla_state !== 'EXEMPTED');
    } else if (filterStatus === 'AtRisk') {
      // Filter to only show at-risk tickets
      const atRiskIds = new Set(atRiskTickets.map(t => t.id));
      list = list.filter(t => atRiskIds.has(t.id));
    }

    return list;
  }, [activeTickets, filterStatus, selectedRoom, atRiskTickets, decisionIds]);

  const handleAction = async (t: Ticket, action: string) => {
    if (action === 'approve') {
      await unblockTask(t.id, 'SUPERVISOR_APPROVED', 'Approved');
      refresh();
    } else if (action === 'reject') {
      // Open comment modal for rejection
      setCommentAction({ isOpen: true, type: 'reject', ticket: t });
    } else if (action === 'exception') {
      setCommentAction({ isOpen: true, type: 'exception', ticket: t });
    } else if (action === 'reassign') {
      setReassignTicket(t);
      setShowStaffPicker(true);
    } else if (action === 'prioritize') {
      // TODO: Implement prioritize RPC (adjust priority_weight, reorder queue)
      // For now, log and show feedback
      console.log('Prioritize ticket:', t.id);
      alert('Priority increased! (Backend implementation pending)');
    } else if (action === 'resolve') {
      // Open appropriate drawer based on ticket type
      // Supervisor requests open SupervisorDecisionDrawer
      // Other tickets open TicketDetailsDrawer
      const isSupervisorRequest = t.needs_supervisor_action === true ||
        t.supervisor_request_type === 'SLA_EXCEPTION_REQUESTED' ||
        t.supervisor_request_type === 'SUPERVISOR_REQUESTED' ||
        (t.status === 'Paused' && t.reason_code === 'supervisor_approval');

      if (isSupervisorRequest) {
        setSupervisorDrawerTicket(t);
      } else {
        setSelectedTicket(t); // Opens TicketDetailsDrawer
      }
    } else {
      console.log('Action', action, t.id);
    }
  };

  const handleCommentSubmit = async (comment: string) => {
    const { type, ticket } = commentAction;
    if (!ticket || !type) return;

    try {
      if (type === 'reject') {
        // Determine which reject RPC to call based on supervisor_request_type
        // BLOCKED + supervisor_approval uses reject_supervisor_approval
        // SLA_EXCEPTION_REQUESTED uses reject_sla_exception
        const isSlaExceptionRequest =
          ticket.supervisor_request_type === 'SLA_EXCEPTION_REQUESTED';

        const isBlockedSupervisorApproval =
          ticket.supervisor_request_type === 'BLOCKED_SUPERVISOR_APPROVAL' ||
          (ticket.status === 'Paused' &&
            (ticket.reason_code === 'supervisor_approval' || ticket.supervisor_reason_code === 'supervisor_approval'));

        if (isSlaExceptionRequest) {
          await rejectSlaException(ticket.id, comment);
        } else if (isBlockedSupervisorApproval) {
          await rejectSupervisorApproval(ticket.id, comment);
        } else {
          // Default to SLA exception if supervisor_request_type is not clear
          await rejectSlaException(ticket.id, comment);
        }
      } else if (type === 'exception') {
        await grantSlaException(ticket.id, comment);
      }
      refresh();
    } catch (e) {
      console.error('Action failed', e);
      alert('Action failed: ' + (e as any).message);
    } finally {
      setCommentAction({ isOpen: false, type: null, ticket: null });
    }
  };

  const handleFilterClick = (status: "All" | "New" | "InProgress" | "Blocked" | "AtRisk") => {
    // Toggle logic: if clicking existing active filter, clear it.
    if (filterStatus === status && status !== 'All') {
      setFilterStatus('All');
    } else {
      setFilterStatus(status);
    }
    setSelectedRoom(null); // Reset room on status change
  };

  return (
    <div className="min-h-screen bg-[#050505] text-gray-200 font-sans overflow-x-hidden">
      {/* Breadcrumb Header */}
      <header className="flex h-10 items-center border-b border-white/10 bg-[#0B0B0B] px-6 shadow-sm shrink-0">
        <div className="flex items-center gap-2 text-xs">
          <Link to={hotelSlug ? `/owner/${hotelSlug}` : '/owner'} className="font-medium text-slate-400 hover:text-white">
            Dashboard
          </Link>
          <span className="text-slate-600">›</span>
          <span className="font-semibold text-white">Ops Board</span>
        </div>
      </header>

      <div className="p-6 pb-20">
        {/* HEADER KPI */}
        <div className="flex flex-wrap items-center justify-between gap-6 mb-8">
          <div>
            <div className="flex items-center gap-4 mb-1">
              <h1 className="text-xl font-medium text-white">{hotelName || 'Loading...'}</h1>
              <div className="flex items-center gap-2 px-3 py-1 bg-[#11131A] border border-white/5 rounded-full">
                <div className={`w-1.5 h-1.5 rounded-full ${connectionStatus === 'connected' ? 'bg-emerald-500 animate-pulse' :
                  connectionStatus === 'connecting' ? 'bg-amber-500 animate-pulse' :
                    'bg-red-500'
                  } transition-colors`}></div>
                <span className={`text-xs font-medium ${connectionStatus === 'connected' ? 'text-emerald-500' :
                  connectionStatus === 'connecting' ? 'text-amber-500' :
                    'text-red-500'
                  } transition-colors`}>
                  {connectionStatus === 'connected' ? `Updated: ${lastUpdated.toLocaleTimeString('en-GB', { hour12: false })}` :
                    connectionStatus === 'connecting' ? 'Reconnecting...' :
                      'Disconnected'}
                </span>
              </div>
            </div>
            <div className="flex gap-6 mt-4">
              <div className="text-center">
                <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">Rooms</div>
                <div className="text-2xl font-light text-white">{rooms.length}</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">Active</div>
                <div className="text-2xl font-light text-white">{activeTickets.length}</div>
                <div className="text-[10px] text-red-500 font-bold mt-1">{decisionTickets.length} ALERTS</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">Avg Time</div>
                <div className="text-2xl font-light text-white">{avgTimeMinutes > 0 ? `${avgTimeMinutes}m` : 'N/A'}</div>
              </div>
            </div>
          </div>

          <div className="flex gap-4">
            <StatusBlock
              label="New"
              count={activeTickets.filter(t => t.status === 'Requested').length}
              active={filterStatus === 'New'}
              onClick={() => handleFilterClick('New')}
            />
            <StatusBlock
              label="In Progress"
              count={activeTickets.filter(t => t.status === 'InProgress' || t.status === 'Accepted').length}
              active={filterStatus === 'InProgress'}
              onClick={() => handleFilterClick('InProgress')}
            />
            <StatusBlock
              label="Blocked"
              count={activeTickets.filter(t => t.status === 'Paused' && !decisionIds.has(t.id) && t.sla_state !== 'EXEMPTED').length}
              active={filterStatus === 'Blocked'}
              onClick={() => handleFilterClick('Blocked')}
            />
            <StatusBlock
              label="At Risk"
              count={atRiskTickets.length}
              active={filterStatus === 'AtRisk'}
              onClick={() => handleFilterClick('AtRisk')}
            />
          </div>
        </div>

        {/* MAIN LAYOUT */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

          {/* LEFT COLUMN (Main) */}
          <div className="lg:col-span-8 space-y-8">

            {/* 1. DECISION QUEUE (Needs Supervisor Action) */}
            <section>
              <div className="flex items-center gap-3 mb-4">
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                </span>
                <h2 className="text-sm font-bold text-gray-200 uppercase tracking-widest">Needs Supervisor Action</h2>
              </div>

              <div className="space-y-4">
                {decisionTickets.length === 0 ? (
                  <div className="p-8 rounded-xl bg-[#0B0C10] border border-dashed border-white/5 text-center">
                    <p className="text-gray-500 text-sm">No pending decisions. You're all caught up!</p>
                  </div>
                ) : (
                  decisionTickets.map(t => (
                    <DecisionCard key={t.id} ticket={t} onAction={handleAction} onClick={() => setSelectedTicket(t)} />
                  ))
                )}
              </div>
            </section>

            {/* 2. BLOCKED & AT-RISK (moved from right column) */}
            <section>
              <div className="flex items-center justify-between mb-4">
                {filterStatus !== 'All' || selectedRoom ? (
                  <div className="flex items-center gap-2">
                    <span className="text-blue-500">🔍</span>
                    <h2 className="text-sm font-bold text-gray-200 uppercase tracking-widest">
                      {selectedRoom ? `Room ${selectedRoom}` : `${filterStatus === 'AtRisk' ? 'At Risk' : filterStatus === 'InProgress' ? 'In Progress' : filterStatus} Tasks`}
                    </h2>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-amber-500">⚠️</span>
                    <h2 className="text-sm font-bold text-gray-200 uppercase tracking-widest">Blocked & At-Risk</h2>
                  </div>
                )}
                {(filterStatus !== 'All' || selectedRoom) && (
                  <button onClick={() => { setFilterStatus('All'); setSelectedRoom(null); }} className="text-[10px] text-gray-500 hover:text-white uppercase">Clear</button>
                )}
              </div>

              <div className="bg-[#0B0C10] border border-white/5 rounded-2xl p-4 min-h-[200px] space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar">
                {/* If Filter is active, show Context Tickets. Else show Oversight Tickets */}
                {(filterStatus !== 'All' || selectedRoom) ? (
                  <>
                    <div className="grid grid-cols-[40px_1fr_40px] gap-4 mb-2 px-2 text-[10px] font-bold text-gray-600 uppercase tracking-widest">
                      <div>Room</div>
                      <div>Task</div>
                      <div className="text-right">SLA</div>
                    </div>
                    {contextTickets.length === 0 ? (
                      <div className="text-center py-8 text-gray-600 text-xs">No active tasks match filter.</div>
                    ) : (
                      contextTickets.map(t => (
                        <ContextTaskCard
                          key={t.id}
                          ticket={t}
                          onClick={() => setSelectedTicket(t)}
                          onAction={handleAction}
                          filterType={filterStatus}
                          assigneeName={staffMembers.find(s => s.id === t.assignee_id)?.full_name}
                        />
                      ))
                    )}
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-[40px_1fr_auto] gap-4 mb-2 px-2 text-[10px] font-bold text-gray-600 uppercase tracking-widest">
                      <div>Room</div>
                      <div>Issue</div>
                      <div className="text-right">Status</div>
                    </div>

                    {oversightTickets.length === 0 ? (
                      <div className="text-center py-8 text-gray-600 text-xs">No overdue or blocked items.</div>
                    ) : (
                      oversightTickets.map(t => (
                        <OversightCard key={t.id} ticket={t} onAction={handleAction} onClick={() => setSelectedTicket(t)} />
                      ))
                    )}
                  </>
                )}
              </div>
            </section>

          </div>

          {/* RIGHT COLUMN */}
          <div className="lg:col-span-4 space-y-6">

            {/* 1. OVERVIEW - Counts & Aggregates (NEW) */}
            <section className="bg-[#0B0C10] border border-white/5 rounded-2xl p-4">
              <h2 className="text-sm font-bold text-gray-200 uppercase tracking-widest mb-4">Overview</h2>

              <div className="space-y-3">
                {/* Automated Alerts */}
                <div className="flex items-center justify-between py-2 border-b border-white/5">
                  <span className="text-sm text-gray-300">Automated Alerts</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">{decisionTickets.length}</span>
                    <span className="text-gray-600">›</span>
                  </div>
                </div>
                <div
                  className="flex items-center justify-between py-2 pl-4 cursor-pointer hover:bg-white/5 rounded transition-colors"
                  onClick={() => { setFilterStatus('All'); setSelectedRoom(null); }}
                >
                  <span className="text-sm text-red-400">▲ {decisionTickets.length} Alerts</span>
                  <span className="text-gray-600">›</span>
                </div>

                {/* Blocked Tickets */}
                <div className="flex items-center justify-between py-2 border-b border-white/5">
                  <span className="text-sm text-gray-300">Blocked Tickets</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">{activeTickets.filter(t => t.status === 'Paused').length}</span>
                    <span className="text-gray-600">›</span>
                  </div>
                </div>
                <div
                  className="flex items-center justify-between py-2 pl-4 cursor-pointer hover:bg-white/5 rounded transition-colors"
                  onClick={() => handleFilterClick('Blocked')}
                >
                  <span className="text-sm text-red-400">▲ {activeTickets.filter(t => t.status === 'Paused').length} Blocked</span>
                  <span className="text-gray-600">›</span>
                </div>

                {/* At Risk Tickets */}
                <div
                  className="flex items-center justify-between py-2 cursor-pointer hover:bg-white/5 rounded transition-colors"
                  onClick={() => { setFilterStatus('All'); setSelectedRoom(null); }}
                >
                  <span className="text-sm text-gray-300">At Risk Tickets</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">{atRiskTickets.length}</span>
                    <span className="text-gray-600">›</span>
                  </div>
                </div>
              </div>
            </section>

            {/* 2. STAFF LOAD (moved from left) */}
            <section className="bg-[#0B0C10] border border-white/5 rounded-2xl p-4">
              <h2 className="text-sm font-bold text-gray-200 uppercase tracking-widest mb-4">Staff Load</h2>
              <div className="space-y-3">
                {staffLoad.map((staff, i) => (
                  <div key={staff.id} className="flex items-center justify-between py-1">
                    <span className="text-sm text-gray-300">{staff.full_name}</span>
                    <span className="text-sm text-gray-400">{staff.taskCount} Tasks</span>
                  </div>
                ))}
                {staffLoad.length === 0 && <div className="text-xs text-gray-600">No staff online</div>}
                {staffLoad.length > 0 && (
                  <div className="text-right">
                    <span className="text-[10px] text-gray-500 hover:text-white cursor-pointer">View All ›</span>
                  </div>
                )}
              </div>
            </section>

            {/* 3. ROOM STATUS (Grid) */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 border border-gray-600 rounded-sm"></div>
                  <h2 className="text-sm font-bold text-gray-200 uppercase tracking-widest">Room Status</h2>
                </div>
              </div>

              <div className="bg-[#0B0C10] border border-white/5 rounded-2xl p-4">
                <div className="grid grid-cols-6 gap-2">
                  {rooms.map(r => {
                    // Determine status based on ticket map
                    // Fix: Match if room number appears in the location label (or exact match)
                    const occupied = activeTickets.some(t => t.room === r.number || t.room.includes(` ${r.number}`));
                    const risk = oversightTickets.some(t => t.room === r.number || t.room.includes(` ${r.number}`));
                    const decision = decisionTickets.some(t => t.room === r.number || t.room.includes(` ${r.number}`));
                    const isSelected = selectedRoom === r.number;

                    let bg = 'bg-[#1A1C25] text-gray-600 border-white/5';
                    if (decision) bg = 'bg-red-500 text-white border-red-400';
                    else if (risk) bg = 'bg-amber-500/20 text-amber-500 border-amber-500/50';
                    else if (occupied) bg = 'bg-blue-600 text-white border-blue-400';

                    // Selection overrides
                    if (isSelected) bg = 'bg-white text-black border-white';

                    return (
                      <div
                        key={r.number}
                        onClick={() => {
                          if (isSelected) setSelectedRoom(null);
                          else {
                            setSelectedRoom(r.number);
                            setFilterStatus('All'); // Clearing status filter when selecting room usually makes more sense
                          }
                        }}
                        className={`aspect-square flex items-center justify-center rounded text-[10px] font-mono border ${bg} cursor-pointer hover:brightness-110 transition-all`}
                      >
                        {r.number}
                      </div>
                    )
                  })}
                </div>
              </div>
            </section>

          </div>
        </div>

        <CommentModal
          isOpen={commentAction.isOpen}
          title={commentAction.type === 'reject' ? 'Reject Request' : 'Grant SLA Exception'}
          onClose={() => setCommentAction({ isOpen: false, type: null, ticket: null })}
          onSubmit={handleCommentSubmit}
        />

        {showStaffPicker && reassignTicket && hotelId && (
          <StaffPicker
            hotelId={hotelId}
            currentAssigneeId={reassignTicket.assignee_id}
            onSelect={async (sid) => {
              await reassignTask(reassignTicket.id, sid, 'sup', 'Reassigned');
              refresh();
              setShowStaffPicker(false);
            }}
            onCancel={() => setShowStaffPicker(false)}
          />
        )}

        {/* Ticket Details Drawer - Restored */}
        <TicketDetailsDrawer
          isOpen={!!selectedTicket}
          onClose={() => setSelectedTicket(null)}
          ticket={selectedTicket ? {
            ...selectedTicket,
            ticket_id: selectedTicket.id,
            title: selectedTicket.service_key.replace(/_/g, ' '),
            department_name: 'Service',
            sla_state: selectedTicket.is_overdue ? 'BREACHED' : 'OK',
            sla_breached: selectedTicket.is_overdue,
            sla_label: (selectedTicket.mins_remaining || 0) + ' min',
            requested_by: 'Guest',
            // Map assignee fields for staff workload
            assigned_staff_id: selectedTicket.assignee_id,
            assigned_user_id: selectedTicket.assignee_id,
            assigned_to_name: selectedTicket.assignee_name,
          } as any : null}
          onStart={() => { if (selectedTicket) handleAction(selectedTicket, 'start'); }}
          onComplete={() => { if (selectedTicket) handleAction(selectedTicket, 'resolve'); }}
          onCancel={refresh}
          onUpdate={refresh}
        />

        {/* Supervisor Decision Drawer */}
        <SupervisorDecisionDrawer
          isOpen={!!supervisorDrawerTicket}
          onClose={() => setSupervisorDrawerTicket(null)}
          ticket={supervisorDrawerTicket}
          onDecision={() => {
            refresh();
            setSupervisorDrawerTicket(null);
          }}
        />

      </div>
    </div>
  );
}
