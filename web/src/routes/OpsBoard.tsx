import {
  useEffect,
  useState,
  useMemo,
  useCallback,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  listTickets,
  listOrders,
  listRooms,
  updateTicket,
  unblockTask,
  reassignTask,
  rejectSupervisorRequest,
  grantSlaException,
  IS_SUPABASE_FUNCTIONS,
} from "../lib/api";
import { connectEvents } from "../lib/sse";
import { supabase } from "../lib/supabase";
import { StaffPicker } from "../components/StaffPicker";
import TicketDetailsDrawer from "../components/TicketDetailsDrawer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TicketStatus = "Requested" | "Accepted" | "InProgress" | "Done" | "Paused";
type TicketPriority = "low" | "normal" | "high" | "urgent" | string;

type Ticket = {
  id: string;
  service_key: string;
  room: string;
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
    raw?.room_number ?? raw?.room?.number ?? raw?.room ?? raw?.roomNo ?? raw?.unit ?? "-"
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
  };
}

function useEffectiveHotelId() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlHotelId = searchParams.get("hotelId");
  const [hotelId, setHotelId] = useState<string | null>(urlHotelId);
  const [initialised, setInitialised] = useState(false);
  const [debugMsg, setDebugMsg] = useState<string>("");

  useEffect(() => {
    if (urlHotelId) {
      setHotelId(urlHotelId);
      setInitialised(true);
      return;
    }
    (async () => {
      try {
        const { data: userRes } = await supabase.auth.getUser();
        if (!userRes?.user) {
          setDebugMsg("No user logged in");
          return;
        }
        const { data: memberData } = await supabase
          .from("hotel_members")
          .select("hotel_id")
          .eq("user_id", userRes.user.id)
          .limit(1)
          .maybeSingle();

        if (memberData?.hotel_id) {
          setHotelId(memberData.hotel_id);
          const next = new URLSearchParams(searchParams);
          next.set("hotelId", memberData.hotel_id);
          setSearchParams(next, { replace: true });
        }
      } catch (e) {
        console.error(e);
      } finally {
        setInitialised(true);
      }
    })();
  }, [searchParams]);

  return { hotelId, initialised, debugMsg };
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
          placeholder="Enter reason (mandatory)..."
          value={comment}
          onChange={e => setComment(e.target.value)}
        />
        <div className="flex justify-end gap-3 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white text-sm">Cancel</button>
          <button
            disabled={!comment.trim()}
            onClick={() => {
              if (comment.trim()) {
                onSubmit(comment);
                setComment("");
              }
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
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
  colorClass,
  active,
  onClick,
}: {
  label: string;
  count: number;
  colorClass: string;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center rounded-xl px-4 py-3 min-w-[100px] transition-all cursor-pointer
        ${active ? "bg-[#1A1C25] ring-1 ring-blue-500/50 scale-105" : "bg-[#111218] hover:bg-[#1A1C25] border border-white/5"}
      `}
    >
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</h3>
        {active && <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>}
      </div>
      <span className={`text-2xl font-light text-white tracking-tight ${colorClass}`}>{count}</span>
    </div>
  );
}

function DecisionCard({ ticket, onAction, onClick }: { ticket: Ticket; onAction: (t: Ticket, action: string) => void; onClick: () => void }) {
  // Use explicit request type if available, otherwise heuristic fallback including Blocked status
  const isSupervisorReq = ticket.supervisor_request_type === 'SUPERVISOR_REQUESTED' ||
    (!ticket.supervisor_request_type && ticket.supervisor_reason_code === 'supervisor_approval') ||
    (ticket.status === 'Paused' && ticket.reason_code === 'supervisor_approval');

  // Use supervisor_reason_code if available, else check block reason
  const reason = ticket.supervisor_reason_code === 'supervisor_approval' || (ticket.status === 'Paused' && ticket.reason_code === 'supervisor_approval')
    ? 'Supervisor Approval'
    : (ticket.supervisor_reason_code || ticket.reason_code || 'Attention Needed');

  // Helper to safely format room number
  const room = String(ticket.room || ticket.room_number || '-').trim();

  return (
    <div
      onClick={onClick}
      className="bg-[#111218] border border-red-900/30 rounded-lg p-4 relative group hover:border-red-900/50 transition-all cursor-pointer"
    >
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500 rounded-l-lg"></div>

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
                  Supervisor Requested
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="flex items-center gap-1.5 justify-end mb-1">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
            <span className="text-sm font-mono text-amber-400 font-bold">{Math.abs(ticket.mins_remaining || 0)}m</span>
          </div>
          <div className="text-[10px] text-red-500 font-bold uppercase tracking-wider">SLA Breached</div>
        </div>
      </div>

      <div className="ml-16 py-2 px-3 bg-red-950/30 rounded border border-red-900/20 text-xs text-red-200 mb-4 flex gap-2 items-center">
        <span className="text-red-500">⚠️</span>
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
              onClick={() => onAction(ticket, 'reassign')}
              className="px-4 py-1.5 bg-[#1A1C25] border border-gray-700 text-gray-300 text-xs font-bold uppercase rounded hover:bg-gray-800 transition-colors">
              Reassign
            </button>
            <button
              onClick={() => onAction(ticket, 'approve')}
              className="px-4 py-1.5 bg-amber-500 text-black text-xs font-bold uppercase rounded hover:bg-amber-400 transition-colors">
              Approve
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onAction(ticket, 'reject')} // SLA Exception rejection uses same 'reject' action type but different backend RPC (handled in generic reject)
              className="px-4 py-1.5 bg-[#1A1C25] border border-red-900/50 text-red-400 text-xs font-bold uppercase rounded hover:bg-red-900/20 transition-colors">
              Reject
            </button>
            <button
              onClick={() => onAction(ticket, 'exception')}
              className="px-4 py-1.5 bg-[#1A1C25] border border-amber-900/50 text-amber-500 text-xs font-bold uppercase rounded hover:bg-amber-900/20 transition-colors">
              Grant Exception
            </button>
            <button
              onClick={() => onAction(ticket, 'resolve')}
              className="px-4 py-1.5 bg-[#1A1C25] border border-gray-700 text-gray-300 text-xs font-bold uppercase rounded hover:bg-gray-800 transition-colors">
              Manage
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function OversightCard({ ticket, onAction, onClick }: { ticket: Ticket; onAction: (t: Ticket, action: string) => void; onClick: () => void }) {
  const isRisk = !ticket.is_overdue && (ticket.mins_remaining || 0) < 15;
  const isBlocked = ticket.status === 'Paused';
  const statusColor = isBlocked ? 'text-red-400' : isRisk ? 'text-amber-400' : 'text-red-500';
  const borderColor = isBlocked ? 'border-red-900/30' : 'border-amber-900/30';
  const label = isBlocked ? 'Blocked' : ticket.is_overdue ? 'SLA Breached' : 'At Risk';
  const labelBg = isBlocked ? 'bg-red-950/50' : ticket.is_overdue ? 'bg-red-950/30' : 'bg-amber-950/30';

  return (
    <div
      onClick={onClick}
      className={`bg-[#111218] border ${borderColor} rounded-lg p-3 flex items-center gap-4 hover:bg-[#15161c] transition-colors group cursor-pointer`}
    >
      <div className="text-xl font-light text-gray-300 w-10 text-center">{ticket.room}</div>

      <div className="flex-1 min-w-0">
        <div className="flex gap-1 mb-1">
          {/* Compact Tags */}
          <span className="px-1.5 py-0.5 bg-[#1A1C25] rounded text-[10px] text-blue-300 font-mono border border-blue-900/30">
            {ticket.id.slice(0, 4)}
          </span>
        </div>
        <div className="text-xs text-gray-500 truncate">{ticket.service_key}</div>
      </div>

      <div className="text-right flex flex-col items-end gap-1">
        <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${labelBg} ${statusColor} border border-white/5`}>
          {label}
        </div>
      </div>
    </div>
  );
}

function ContextTaskCard({ ticket, onClick }: { ticket: Ticket; onClick: () => void }) {
  const isNew = ticket.status === 'Requested';

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 p-3 rounded-lg bg-[#111218] border border-white/5 hover:bg-[#1A1C25] cursor-pointer transition-colors"
    >
      <div className={`w-2 h-2 rounded-full ${isNew ? 'bg-blue-500' : 'bg-amber-500'}`}></div>
      <div className="text-lg font-light text-white w-10">{ticket.room}</div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-gray-300 truncate">{ticket.service_key}</div>
        <div className="text-[10px] text-gray-500">{ticket.assignee_name || 'Unassigned'}</div>
      </div>
      <div className="text-[10px] font-mono text-gray-600">{Math.floor(ticket.mins_remaining || 0)}m</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function OpsBoard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hotelId, initialised } = useEffectiveHotelId();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);

  // State
  const [filterStatus, setFilterStatus] = useState<"All" | "New" | "InProgress" | "Blocked">("All");
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null); // For Details Drawer

  // Modals
  const [showStaffPicker, setShowStaffPicker] = useState(false);
  const [reassignTicket, setReassignTicket] = useState<Ticket | null>(null);

  const [commentAction, setCommentAction] = useState<{
    isOpen: boolean;
    type: 'reject' | 'exception' | null;
    ticket: Ticket | null;
  }>({ isOpen: false, type: null, ticket: null });

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
      const off = connectEvents({
        ticket_created: () => refresh(),
        ticket_updated: () => refresh(),
      });
      const pollInterval = setInterval(refresh, 10000);
      return () => { off(); clearInterval(pollInterval); };
    }
  }, [initialised, hotelId, refresh]);

  // CATEGORIZATION LOGIC
  const activeTickets = tickets.filter(t => t.status !== "Done");

  // Decision: Waiting for supervisor approval (Using computed flag OR legacy block reason)
  const decisionTickets = activeTickets.filter(t =>
    t.needs_supervisor_action ||
    (t.status === 'Paused' && t.reason_code === 'supervisor_approval')
  );

  const decisionIds = new Set(decisionTickets.map(t => t.id));

  // Oversight: Blocked OR Breached OR At Risk (<15m) -- excluding decisions
  const oversightTickets = activeTickets.filter(t => {
    if (decisionIds.has(t.id)) return false;
    if (t.status === 'Paused') return true;
    if (t.is_overdue) return true;
    if ((t.mins_remaining || 100) < 15) return true;
    return false;
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
      list = list.filter(t => t.status === 'Paused' || t.is_overdue);
    }

    return list;
  }, [activeTickets, filterStatus, selectedRoom]);

  const handleAction = async (t: Ticket, action: string) => {
    if (action === 'approve') {
      await unblockTask(t.id, 'SUPERVISOR_APPROVED', 'Approved');
      refresh();
    } else if (action === 'exception') {
      setCommentAction({ isOpen: true, type: 'exception', ticket: t });
    } else if (action === 'reassign') {
      setReassignTicket(t);
      setShowStaffPicker(true);
    } else {
      console.log('Action', action, t.id);
    }
  };

  const handleCommentSubmit = async (comment: string) => {
    const { type, ticket } = commentAction;
    if (!ticket || !type) return;

    try {
      if (type === 'reject') {
        await rejectSupervisorRequest(ticket.id, comment);
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

  const handleFilterClick = (status: "All" | "New" | "InProgress" | "Blocked") => {
    // Toggle logic: if clicking existing active filter, clear it.
    if (filterStatus === status && status !== 'All') {
      setFilterStatus('All');
    } else {
      setFilterStatus(status);
    }
    setSelectedRoom(null); // Reset room on status change
  };

  return (
    <div className="min-h-screen bg-[#050505] text-gray-200 font-sans p-6 pb-20 overflow-x-hidden">
      {/* HEADER KPI */}
      <div className="flex flex-wrap items-center justify-between gap-6 mb-8">
        <div>
          <h1 className="text-xl font-medium text-white mb-1">Vaiyu Residency <span className="text-xs px-2 py-0.5 bg-white/10 rounded ml-2 text-gray-400">SYNC</span></h1>
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
              <div className="text-2xl font-light text-white">7m</div>
            </div>
          </div>
        </div>

        <div className="flex gap-4">
          <StatusBlock
            label="New"
            count={activeTickets.filter(t => t.status === 'Requested').length}
            colorClass="text-blue-400"
            active={filterStatus === 'New'}
            onClick={() => handleFilterClick('New')}
          />
          <StatusBlock
            label="In Progress"
            count={activeTickets.filter(t => t.status === 'InProgress' || t.status === 'Accepted').length}
            colorClass="text-gray-400"
            active={filterStatus === 'InProgress'}
            onClick={() => handleFilterClick('InProgress')}
          />
          <StatusBlock
            label="Blocked"
            count={activeTickets.filter(t => t.status === 'Paused' || t.is_overdue).length}
            colorClass="text-gray-400"
            active={filterStatus === 'Blocked'}
            onClick={() => handleFilterClick('Blocked')}
          />
          <StatusBlock
            label="At Risk"
            count={oversightTickets.length}
            colorClass="text-amber-500"
            active={false}
            onClick={() => { }}
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

          {/* 4. STAFF LOAD */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Staff Load */}
            <div className="bg-[#0B0C10] border border-white/5 rounded-2xl p-6 h-fit">
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-6">Staff Load Overview</h2>
              <div className="space-y-4">
                {staffLoad.map((staff, i) => (
                  <div key={staff.id}>
                    <div className="flex justify-between text-xs mb-2">
                      <span className="text-gray-300 font-medium">{staff.full_name}</span>
                      <span className="text-gray-500">{staff.taskCount} Tasks</span>
                    </div>
                    <div className="h-1.5 w-full bg-[#1A1C25] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${i === 0 ? 'bg-amber-500' : 'bg-green-600'}`}
                        style={{ width: `${Math.min((staff.taskCount / 5) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
                {staffLoad.length === 0 && <div className="text-xs text-gray-600">No staff online</div>}
              </div>
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN */}
        <div className="lg:col-span-4 space-y-8">

          {/* 2. OVERSIGHT QUEUE OR CONTEXT QUEUE */}
          <section>
            <div className="flex items-center justify-between mb-4">
              {filterStatus !== 'All' || selectedRoom ? (
                <div className="flex items-center gap-2">
                  <span className="text-blue-500">🔍</span>
                  <h2 className="text-sm font-bold text-gray-200 uppercase tracking-widest">
                    {selectedRoom ? `Room ${selectedRoom}` : `${filterStatus} Tasks`}
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
                      <ContextTaskCard key={t.id} ticket={t} onClick={() => setSelectedTicket(t)} />
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
                  const occupied = activeTickets.some(t => t.room === r.number);
                  const risk = oversightTickets.some(t => t.room === r.number);
                  const decision = decisionTickets.some(t => t.room === r.number);
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
          requested_by: 'Guest'
        } as any : null}
        onStart={() => { if (selectedTicket) handleAction(selectedTicket, 'start'); }}
        onComplete={() => { if (selectedTicket) handleAction(selectedTicket, 'resolve'); }}
        onCancel={refresh}
        onUpdate={refresh}
      />
    </div>
  );
}
