// web/src/routes/OpsBoard.tsx
import {
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  listTickets,
  listOrders,
  listRooms,
  updateTicket,
  getSupervisorTaskHeader,
  getTicketTimeline,
  unblockTask,
  reassignTask,
  IS_SUPABASE_FUNCTIONS,
  type Room,
} from "../lib/api";
import { connectEvents } from "../lib/sse";
import { supabase } from "../lib/supabase";
import { StaffPicker } from "../components/StaffPicker";

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
  reason_code?: string;
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
    raw?.service_key ?? raw?.key ?? raw?.service ?? "service"
  ).trim();
  const room = String(
    raw?.room?.number ?? raw?.room_number ?? raw?.room ?? raw?.roomNo ?? raw?.unit ?? "-"
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
    priority: raw?.priority,
    mins_remaining,
    reason_code: raw?.reason_code,
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

        const email = userRes.user.email || "";
        setDebugMsg(`User: ${email}`);

        // 1. Check membership (handle multiple rows by taking first)
        const { data: memberData } = await supabase
          .from("hotel_members")
          .select("hotel_id")
          .eq("user_id", userRes.user.id)
          .limit(1)
          .maybeSingle(); // maybeSingle works fine with limit(1)

        let foundId = memberData?.hotel_id;
        if (foundId) setDebugMsg(prev => prev + ` | Member: Found (${foundId.slice(0, 4)}...)`);
        else setDebugMsg(prev => prev + ` | Member: None`);

        // 2. Check slug match (email prefix == slug)
        if (!foundId && email) {
          const slug = email.split("@")[0];
          const { data: slugData } = await supabase
            .from("hotels")
            .select("id")
            .ilike("slug", slug)
            .maybeSingle();
          if (slugData) {
            foundId = slugData.id;
            setDebugMsg(prev => prev + ` | Slug: Found (${slug})`);
          } else {
            setDebugMsg(prev => prev + ` | Slug: No match for ${slug}`);
          }
        }

        // 3. Check ownership (try/catch in case owner_id column missing)
        if (!foundId) {
          try {
            const { data: ownerData } = await supabase
              .from("hotels")
              .select("id")
              .eq("owner_id", userRes.user.id)
              .limit(1)
              .maybeSingle();

            if (ownerData) {
              foundId = ownerData.id;
              setDebugMsg(prev => prev + ` | Owner: Found`);
            } else {
              setDebugMsg(prev => prev + ` | Owner: None`);
            }
          } catch (err: any) {
            console.warn("Owner ID check failed", err);
            setDebugMsg(prev => prev + ` | Owner Check Error: ${err.message || String(err)}`);
          }
        }

        if (foundId) {
          setHotelId(foundId);
          const next = new URLSearchParams(searchParams);
          next.set("hotelId", foundId);
          setSearchParams(next, { replace: true });
        }
      } catch (e) {
        console.error(e);
        setDebugMsg(prev => prev + " | Error " + String(e));
      } finally {
        setInitialised(true);
      }
    })();
  }, [searchParams]);

  return { hotelId, initialised, debugMsg };
}

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const FLOORS = [1, 2, 3, 4, 5, 6, 9];
const ROOMS_PER_FLOOR = 19;

type RoomNode = {
  number: string;
  floor: number;
  id?: string;
};

const GENERATED_ROOMS: RoomNode[] = FLOORS.flatMap((f) =>
  Array.from({ length: ROOMS_PER_FLOOR }, (_, i) => ({
    floor: f,
    number: `${f}${String(i + 1).padStart(2, "0")}`,
  }))
);

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

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
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center rounded-lg px-2 py-3 min-w-[90px] transition-all
        ${active ? "bg-[#1A1C25] ring-1 ring-white/10 translate-y-0.5" : "bg-[#111218] hover:bg-[#1A1C25]"}
      `}
    >
      <h3 className="text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">{label}</h3>
      <span className="text-3xl font-bold text-white tracking-tight">{count}</span>
      {/* Active Indicator Line */}
      <div className={`absolute bottom-0 left-0 right-0 h-1 rounded-b-lg transition-opacity ${colorClass} ${active ? 'opacity-100' : 'opacity-40'}`}></div>
    </button>
  );
}

function RoomCell({
  room,
  status,
  hasActiveTicket,
  isBlocked,
  dimmed,
  onClick,
}: {
  room: string;
  status: TicketStatus | "Clean" | null;
  hasActiveTicket: boolean;
  isBlocked?: boolean;
  dimmed: boolean;
  onClick: () => void;
}) {
  // Default (Inactive)
  let bg = "#111218";
  let text = "#4b5563"; // Gray 600 - darker for inactive
  let border = "1px solid #1f2937";

  // Active States logic (only apply if NOT dimmed/filtered out)
  if (!dimmed) {
    if (isBlocked) {
      // Blocked/Overdue -> RED
      bg = "#7f1d1d"; // Red 900
      text = "#fca5a5"; // Red 300
      border = "1px solid #ef4444"; // Red 500
    } else if (status === "InProgress") {
      // In Progress -> GREEN
      bg = "#14532d"; // Green 900
      text = "#86efac"; // Green 300
      border = "1px solid #22c55e"; // Green 500
    } else if (status === "Requested" || status === "Accepted") {
      // New/Accepted -> BLUE (Cyan-ish)
      bg = "#1e3a8a"; // Blue 900
      text = "#93c5fd"; // Blue 300
      border = "1px solid #3b82f6"; // Blue 500
    }
  }

  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-center text-[10px] font-mono rounded-sm cursor-pointer hover:brightness-125 transition-all
        ${hasActiveTicket && !dimmed ? 'font-bold' : 'font-normal'}
      `}
      style={{
        width: 34,
        height: 34,
        backgroundColor: bg,
        color: text,
        border: border,
        // User requested NO graying out/opacity changes
      }}
    >
      {room}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

// ... imports

export default function OpsBoard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hotelId, initialised, debugMsg } = useEffectiveHotelId();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [orders, setOrders] = useState<Order[]>([]);
  const [rooms, setRooms] = useState<RoomNode[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);

  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  // Filter state
  const [filterStatus, setFilterStatus] = useState<"All" | "New" | "InProgress" | "Blocked">("All");
  // Staff data
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(true);

  // Staff picker for reassignment
  const [showStaffPicker, setShowStaffPicker] = useState(false);
  const [reassignTicket, setReassignTicket] = useState<Ticket | null>(null);

  const refresh = useCallback(async () => {
    if (!hotelId) {
      console.log("OpsBoard: No hotelId yet");
      return;
    }
    console.log("OpsBoard: Refreshing for hotelId:", hotelId);

    // Use allSettled so one failure doesn't break the whole dashboard
    const [tRes, oRes, rRes] = await Promise.allSettled([
      listTickets(hotelId),
      listOrders(hotelId),
      listRooms(hotelId)
    ]);

    // 1. Tickets
    if (tRes.status === "fulfilled") {
      const rawTickets = ((tRes.value as any).items || []) as any[];
      setTickets(rawTickets.map(normalizeTicket));
    } else {
      console.error("OpsBoard: Failed to load tickets", tRes.reason);
    }

    // 2. Orders
    if (oRes.status === "fulfilled") {
      setOrders(((oRes.value as any).items || []) as any[]);
    } else {
      console.error("OpsBoard: Failed to load orders", oRes.reason);
    }

    // 3. Rooms
    let loadedRooms: RoomNode[] = [];
    if (rRes.status === "fulfilled") {
      const r = rRes.value as any[]; // strict typing might fail if not cast
      if (r && r.length > 0) {
        loadedRooms = r.map(x => ({
          number: x.number ?? x.room_number ?? "000",
          floor: x.floor ?? x.floor_number ?? 1,
          id: x.id
        }));
      }
    } else {
      console.error("OpsBoard: Failed to loading rooms", rRes.reason);
    }

    // Fallback to generated if DB is empty or failed
    if (loadedRooms.length > 0) {
      setRooms(loadedRooms);
    } else {
      console.warn("OpsBoard: No rooms found, using generated fallback");
      setRooms(GENERATED_ROOMS);
    }

    setLoadingRooms(false);
  }, [hotelId]);

  // Fetch staff data
  useEffect(() => {
    const loadStaff = async () => {
      if (!hotelId) {
        console.log("No hotelId provided");
        setLoadingStaff(false);
        return;
      }

      console.log("OpsBoard: Loading staff for hotelId:", hotelId);
      setLoadingStaff(true);
      try {
        // 1. Fetch hotel_members
        const { data: members, error: mError } = await supabase
          .from('hotel_members')
          .select('*')
          .eq('hotel_id', hotelId)
          .eq('is_active', true);

        if (mError) throw mError;

        // 2. Fetch profiles for these members
        const userIds = (members || []).map(m => m.user_id).filter(Boolean);
        let profilesData: any[] = [];
        if (userIds.length > 0) {
          const { data: pData } = await supabase
            .from('profiles')
            .select('id, full_name, phone')
            .in('id', userIds);
          profilesData = pData || [];
        }

        // 3. Merge
        const profilesMap = new Map(profilesData.map(p => [p.id, p]));
        const staffProcessed = (members || []).map(m => {
          const p = profilesMap.get(m.user_id);
          return {
            id: m.id,
            user_id: m.user_id,
            role: m.role,
            is_active: m.is_active,
            created_at: m.created_at,
            updated_at: m.updated_at,
            full_name: p?.full_name || `Staff ${m.user_id?.slice(0, 8) || ''}`,
            phone_number: p?.phone || null
          };
        });

        setStaffMembers(staffProcessed);
        console.log("OpsBoard: Successfully loaded", staffProcessed.length, "staff members");
      } catch (e) {
        console.error("OpsBoard: Error loading staff:", e);
        setStaffMembers([]);
      } finally {
        setLoadingStaff(false);
      }
    };

    loadStaff();
  }, [hotelId]);

  useEffect(() => {
    if (initialised && hotelId) {
      refresh();
      const off = connectEvents({
        ticket_created: () => refresh(),
        ticket_updated: () => refresh(),
      });

      // Auto-refresh polling every 10 seconds as fallback
      const pollInterval = setInterval(() => {
        refresh();
      }, 10000); // 10 seconds

      return () => {
        off();
        clearInterval(pollInterval);
      };
    }
  }, [initialised, hotelId, refresh]);

  // Derived state
  const activeTickets = tickets.filter(t => t.status !== "Done");
  const newCount = activeTickets.filter(t => t.status === "Requested").length;
  // InProgress now explicitly includes Accepted properly if we want, but definitely NOT Paused
  const inProgressCount = activeTickets.filter(t => t.status === "InProgress" || t.status === "Accepted").length;
  // Blocked = Overdue OR Paused
  const blockedCount = activeTickets.filter(t => t.is_overdue || t.status === "Paused").length;

  const roomStateMap = useMemo(() => {
    const map = new Map<string, Ticket[]>();
    activeTickets.forEach(t => {
      const r = t.room.trim();
      if (!map.has(r)) map.set(r, []);
      map.get(r)?.push(t);
    });
    return map;
  }, [activeTickets]);

  /* Decoupled: Room and Status filters now work independently */

  const selectedRoomTickets = useMemo(() => {
    // If a room is selected, show only that room's tickets.
    // Otherwise, show all tickets (which will be filtered by status below).
    let list = selectedRoom ? roomStateMap.get(selectedRoom) || [] : activeTickets;

    // Apply the same filter logic to the panel list
    if (filterStatus === "New") {
      list = list.filter(t => t.status === "Requested");
    } else if (filterStatus === "InProgress") {
      list = list.filter(t => t.status === "InProgress" || t.status === "Accepted");
    } else if (filterStatus === "Blocked") {
      list = list.filter(t => t.is_overdue || t.status === "Paused");
    }
    return list;
  }, [selectedRoom, roomStateMap, filterStatus, activeTickets]);

  const handleTicketAction = async (t: Ticket, action: string) => {
    // Handle supervisor approve action
    if (action === 'approve') {
      // Validation: ensure task is blocked with supervisor_approval
      if (t.status !== 'Paused') {
        alert('Cannot approve: Task is not blocked');
        return;
      }
      if (t.reason_code !== 'supervisor_approval') {
        alert('Cannot approve: Task is not waiting for supervisor approval');
        return;
      }

      try {
        // Optimistic update: remove from UI immediately
        setTickets(prev => prev.filter(ticket => ticket.id !== t.id));

        // Call unblock API with SUPERVISOR_APPROVED reason
        await unblockTask(t.id, 'SUPERVISOR_APPROVED', 'Approved by supervisor');

        // Success - refresh to get updated state
        refresh();
      } catch (error) {
        console.error('Failed to approve task:', error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        alert(`Failed to approve task: ${errorMsg}\n\nPlease check the console for details.`);

        // Revert optimistic update by refreshing
        refresh();
      }
      return;
    }

    // Handle reassign action
    if (action === 'reassign') {
      // Validation: ensure task is blocked with supervisor_approval
      if (t.status !== 'Paused') {
        alert('Cannot reassign: Task is not blocked');
        return;
      }
      if (t.reason_code !== 'supervisor_approval') {
        alert('Cannot reassign: Task is not waiting for supervisor approval');
        return;
      }

      // Show staff picker
      setReassignTicket(t);
      setShowStaffPicker(true);
      return;
    }

    // Existing action handlers (start, resolve)
    let nextStatus: TicketStatus = t.status;
    let payload: any = {};

    if (action === "start") {
      nextStatus = "InProgress";
      payload = { action: "start" };
      if (!IS_SUPABASE_FUNCTIONS) payload = { status: "InProgress" };
    } else if (action === "resolve") {
      nextStatus = "Done";
      payload = { action: "resolve" };
      if (!IS_SUPABASE_FUNCTIONS) payload = { status: "Done" };
    }

    // Optimistic update
    setTickets(prev => prev.map(x => x.id === t.id ? { ...x, status: nextStatus } : x));

    try {
      await updateTicket(t.id, payload);
      refresh();
    } catch (e) {
      console.error(e);
      refresh();
    }
  };

  const handleReassign = async (newStaffId: string) => {
    if (!reassignTicket || !hotelId) return;

    try {
      // Optimistic update: remove from UI immediately
      setTickets(prev => prev.filter(t => t.id !== reassignTicket.id));
      setShowStaffPicker(false);
      setReassignTicket(null);

      // Get current user ID (supervisor) - for now using a placeholder
      // TODO: Get actual supervisor ID from auth context
      const supervisorId = 'placeholder-supervisor-id';

      // Call reassign API
      await reassignTask(
        reassignTicket.id,
        newStaffId,
        supervisorId,
        'Reassigned by supervisor'
      );

      // Success - refresh to get updated state
      refresh();
    } catch (error) {
      console.error('Failed to reassign task:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      alert(`Failed to reassign task: ${errorMsg}\n\nPlease check the console for details.`);

      // Revert optimistic update by refreshing
      setShowStaffPicker(false);
      setReassignTicket(null);
      refresh();
    }
  };

  const handleFilterClick = (status: "All" | "New" | "InProgress" | "Blocked") => {
    // Reset room filter when status filter is clicked
    setSelectedRoom(null);

    // Toggle off if clicking active
    if (filterStatus === status && status !== "All") {
      setFilterStatus("All");
    } else {
      setFilterStatus(status);
    }
  };

  // Determine if a room matches the current filter
  const isRoomMatch = (roomNumber: string) => {
    if (filterStatus === "All") return true;
    const roomTickets = roomStateMap.get(roomNumber);
    if (!roomTickets?.length) return false;

    if (filterStatus === "New") return roomTickets.some(t => t.status === "Requested");
    if (filterStatus === "InProgress") return roomTickets.some(t => t.status === "InProgress" || t.status === "Accepted");
    if (filterStatus === "Blocked") return roomTickets.some(t => t.is_overdue || t.status === "Paused");
    return false;
  };

  // Group rooms by floor for display
  const floors = useMemo(() => {
    const floorsMap = new Set<number>();
    rooms.forEach(r => floorsMap.add(r.floor));
    return Array.from(floorsMap).sort((a, b) => a - b);
  }, [rooms]);

  return (
    <div className="min-h-screen bg-[#050505] text-gray-200 font-sans p-8 pb-20">

      {/* Header Area */}
      <div className="flex flex-col xl:flex-row justify-between items-start gap-8 mb-10">

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-6">
            <h1 className="text-2xl font-medium text-white tracking-wide">Vaiyu Residency</h1>
            <button onClick={refresh} className="px-3 py-1 bg-white/5 hover:bg-white/10 text-[10px] uppercase tracking-wider rounded text-gray-400 transition">
              {loadingRooms ? "Loading..." : "Sync"}
            </button>
          </div>

          <div className="flex gap-10 text-xs font-mono">
            <div>
              <div className="text-gray-500 mb-1 uppercase tracking-wider text-[10px]">Rooms</div>
              <div className="text-white text-3xl font-light">{rooms.length}</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1 uppercase tracking-wider text-[10px]">Active</div>
              <div className="text-white text-3xl font-light">{activeTickets.length}</div>
              <div className="text-gray-600 text-[10px]">Tasks</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1 uppercase tracking-wider text-[10px]">Risk</div>
              <div className="text-amber-400 text-3xl font-light">{blockedCount}</div>
              <div className="text-amber-900/60 text-[10px] uppercase font-bold">Alerts</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1 uppercase tracking-wider text-[10px]">Avg Time</div>
              <div className="text-white text-3xl font-light">7<span className="text-lg">m</span></div>
            </div>
          </div>
        </div>

        <div className="flex gap-5">
          <StatusBlock
            label="New"
            count={newCount}
            colorClass="bg-blue-600"
            active={filterStatus === "New"}
            onClick={() => handleFilterClick("New")}
          />
          <StatusBlock
            label="In Progress"
            count={inProgressCount}
            colorClass="bg-yellow-500"
            active={filterStatus === "InProgress"}
            onClick={() => handleFilterClick("InProgress")}
          />
          <StatusBlock
            label="Blocked"
            count={blockedCount}
            colorClass="bg-red-500"
            active={filterStatus === "Blocked"}
            onClick={() => handleFilterClick("Blocked")}
          />
          <StatusBlock
            label="At Risk"
            count={0}
            colorClass="bg-gray-600"
            active={false}
            onClick={() => { }}
          />
        </div>
      </div>

      {/* Calculate supervisor tickets */}
      {(() => {
        const supervisorTickets = activeTickets.filter(t => t.reason_code === 'supervisor_approval' && t.status === 'Paused');

        return (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(400px,1fr)_300px_380px] gap-6">

            <div className="space-y-8">
              {/* Room Grid Card */}
              <div className="bg-[#0B0C10] border border-white/5 rounded-2xl p-8">
                <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-6">Room Status</h2>

                <div className="flex justify-center">
                  {/* Dynamic Grid Layout */}
                  <div className="flex flex-col gap-2">
                    {floors.map(floor => (
                      <div key={floor} className="flex gap-1 justify-center">
                        {/* Only show rooms for this floor */}
                        {rooms.filter(r => r.floor === floor).map(r => {
                          const roomTickets = roomStateMap.get(r.number) || [];

                          // Filter tickets based on current view to determine COLOR
                          const relevantTickets = roomTickets.filter(t => {
                            if (filterStatus === "All") return true;
                            if (filterStatus === "New") return t.status === "Requested";
                            if (filterStatus === "InProgress") return t.status === "InProgress" || t.status === "Accepted";
                            if (filterStatus === "Blocked") return t.is_overdue || t.status === "Paused";
                            return true;
                          });

                          const primaryTicket = relevantTickets.length > 0 ? relevantTickets[0] : roomTickets[0];
                          // Only show RED/BLOCKED if the RELEVANT tickets are blocked
                          // (Unless filter is All, in which case any block in room makes it red)
                          const isBlocked = relevantTickets.some(t => t.is_overdue || t.status === "Paused");

                          // Match check for dimming (still needed if we want to support dimming in future, or for logic consistency)
                          const isMatch = relevantTickets.length > 0;

                          return (
                            <RoomCell
                              key={r.number}
                              room={r.number}
                              status={primaryTicket?.status || null}
                              hasActiveTicket={!!roomTickets.length} // Keep bold if ANY ticket exists
                              isBlocked={isBlocked}
                              dimmed={!isMatch && filterStatus !== "All"} // Only dim if filter active and no match
                              onClick={() => setSelectedRoom(r.number)}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Tasks At Risk */}
                <div className="bg-[#0B0C10] border border-white/5 rounded-2xl p-6 min-h-[300px]">
                  <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-6">Tasks at Risk</h2>
                  <div className="space-y-4">
                    {tickets.filter(t => t.is_overdue && t.status !== "Done").slice(0, 5).map(t => (
                      <div key={t.id} className="flex items-center gap-4 bg-[#111218] p-3 rounded-lg border border-white/5">
                        <span className={`w-8 h-8 flex items-center justify-center rounded bg-red-500/10 text-red-500 font-bold text-xs`}>
                          !
                        </span>
                        <div>
                          <div className="text-white text-sm font-semibold">Room {t.room}</div>
                          <div className="text-gray-500 text-xs">{t.service_key}</div>
                        </div>
                        <div className="ml-auto text-xs text-red-400 font-mono font-bold">
                          {Math.abs(t.mins_remaining || 0)}m
                        </div>
                      </div>
                    ))}
                    {!tickets.some(t => t.is_overdue && t.status !== "Done") && (
                      <div className="text-gray-700 text-xs italic">No overdue tasks.</div>
                    )}
                  </div>
                </div>

                {/* Staff Activity */}
                <div className="bg-[#0B0C10] border border-white/5 rounded-2xl p-6 min-h-[300px]">
                  <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-6">Staff Activity</h2>
                  {loadingStaff ? (
                    <div className="text-gray-500 text-xs">Loading staff...</div>
                  ) : staffMembers.length === 0 ? (
                    <div className="text-gray-500 text-xs">No active staff found.</div>
                  ) : (
                    <div className="space-y-5">
                      {staffMembers.map((staff, index) => {
                        // Generate consistent colors for each staff member
                        const colors = ["#ef4444", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#f97316"];
                        const color = colors[index % colors.length];

                        // Mock room count for now (you could calculate this from active tickets)
                        const roomsAssigned = Math.floor(Math.random() * 8) + 1;

                        return (
                          <div key={staff.id}>
                            <div className="flex justify-between text-xs mb-2 px-1">
                              <span className="font-semibold text-gray-300">{staff.full_name}</span>
                              <span className="text-gray-500 font-mono">{roomsAssigned} rooms</span>
                            </div>
                            <div className="h-1.5 w-full bg-[#1A1C25] rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${(roomsAssigned / 10) * 100}%`, backgroundColor: color }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ALERTS PANEL - MIDDLE COLUMN */}
            <div className="bg-[#0B0C10] border border-red-900/40 rounded-2xl p-6 h-fit sticky top-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                  </div>
                  <h2 className="text-sm font-bold text-red-400 uppercase tracking-widest">Alerts</h2>
                </div>
                <span className="text-[10px] text-red-300 font-mono bg-red-500/10 px-2 py-1 rounded">
                  {supervisorTickets.length}
                </span>
              </div>

              {supervisorTickets.length === 0 ? (
                <div className="p-6 rounded-xl bg-white/5 border border-dashed border-white/10 text-center">
                  <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-gray-500 mx-auto mb-2">
                    ✓
                  </div>
                  <p className="text-gray-500 text-xs">No supervisor requests</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="bg-red-900/10 px-3 py-2 rounded-lg border border-red-900/20">
                    <h3 className="text-[10px] font-bold text-red-300 uppercase tracking-widest mb-1">Waiting for Supervisor</h3>
                    <div className="text-[10px] text-red-400/70">Requires immediate attention</div>
                  </div>
                  <div className="space-y-2">
                    {supervisorTickets.map(t => (
                      <div key={t.id} className="bg-[#111218] border border-red-900/20 rounded-lg p-3 hover:border-red-900/40 transition-colors cursor-pointer">
                        <div className="flex items-start justify-between mb-2">
                          <div className="text-xs font-semibold text-white">Room {t.room}</div>
                          <div className="text-[10px] text-red-400 font-mono">{t.service_key}</div>
                        </div>
                        <div className="text-[10px] text-gray-500 mb-2">Reason: Supervisor approval</div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleTicketAction(t, 'approve')}
                            className="flex-1 py-1.5 bg-green-900/30 hover:bg-green-900/50 text-green-400 text-[10px] font-bold uppercase rounded border border-green-500/30 transition"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleTicketAction(t, 'reassign')}
                            className="flex-1 py-1.5 bg-[#1A1C25] hover:bg-white/10 text-gray-300 text-[10px] font-bold uppercase rounded border border-white/10 transition"
                          >
                            Reassign
                          </button>
                        </div>
                      </div>
                    ))}</div>
                </div>
              )}
            </div>

            {/* GLOBAL TASKS PANEL - RIGHT COLUMN */}
            <div className="bg-[#0B0C10] border border-white/5 rounded-2xl p-8 h-fit sticky top-6">
              <TaskDetailsPanel
                roomNumber={selectedRoom}
                filterStatus={filterStatus}
                tickets={selectedRoomTickets}
                onAction={handleTicketAction}
              />
            </div>
          </div>
        );
      })()}

  {/* Staff Picker Modal */}
  {showStaffPicker && reassignTicket && hotelId && (
    <StaffPicker
      hotelId={hotelId}
      currentAssigneeId={reassignTicket.assignee_id}
      onSelect={handleReassign}
      onCancel={() => {
        setShowStaffPicker(false);
        setReassignTicket(null);
      }}
    />
  )}
    </div>
  );
}

/**
 * Redesigned Task Panel matching the high-fidelity dark UI.
 */
function TaskDetailsPanel({
  roomNumber,
  filterStatus,
  tickets,
  onAction
}: {
  roomNumber: string | null;
  filterStatus: "All" | "New" | "InProgress" | "Blocked";
  tickets: Ticket[];
  onAction: (t: Ticket, action: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-white tracking-wide">
          {roomNumber ? `Room ${roomNumber}` : (filterStatus === "All" ? "Global Tasks" : `${filterStatus} Tasks`)}
        </h2>
        <span className="text-[10px] font-mono text-gray-400 uppercase tracking-widest bg-white/5 px-2 py-1 rounded">
          {tickets.length} total
        </span>
      </div>

      {tickets.length === 0 && (
        <div className="p-8 rounded-xl bg-white/5 border border-dashed border-white/10 text-center flex flex-col items-center justify-center gap-2">
          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-gray-500">
            ✓
          </div>
          <p className="text-gray-500 text-xs">No active tasks in this view.</p>
        </div>
      )}

      {tickets.map(t => (
        <TaskItem key={t.id} t={t} onAction={onAction} />
      ))}
    </div>
  );
}

/**
 * Individual Ticket Card that fetches its own dynamic details from views.
 */
function TaskItem({ t, onAction }: { t: Ticket, onAction: (t: Ticket, action: string) => void }) {
  const [header, setHeader] = useState<any>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [h, tl] = await Promise.all([
        getSupervisorTaskHeader(t.id),
        getTicketTimeline(t.id)
      ]);
      setHeader(h);
      setTimeline(tl);
      setLoading(false);
    }
    load();
  }, [t.id]);

  if (loading) {
    return (
      <div className="bg-[#121212] rounded-xl p-5 border border-white/5 shadow-xl animate-pulse">
        <div className="h-4 bg-white/5 rounded w-1/2 mb-4"></div>
        <div className="h-20 bg-white/5 rounded mb-4"></div>
        <div className="h-10 bg-white/5 rounded"></div>
      </div>
    );
  }

  // Use view data if available, fallback to ticket data
  const status = header?.status || t.status;
  const taskType = header?.task_type || t.service_key;
  const slaLabel = header?.sla_label || (t.mins_remaining ? `${t.mins_remaining} min left` : '12 min left');
  const priority = header?.priority || t.priority || 'NORMAL';
  const createdTime = header?.created_at ? new Date(header.created_at) : new Date(t.created_at);

  const isBlocked = status === 'BLOCKED' || status === 'Paused' || t.is_overdue;
  const isInProgress = status === 'IN_PROGRESS' || status === 'InProgress' || status === 'Accepted';
  const isNew = status === 'NEW' || status === 'Requested';

  let borderColor = "border-white/5";
  let statusColor = "text-gray-400";
  let statusIcon = "•";

  if (isBlocked) {
    borderColor = "border-red-500/30";
    statusColor = "text-red-400";
    statusIcon = "!";
  } else if (isInProgress) {
    borderColor = "border-amber-500/30";
    statusColor = "text-amber-400";
    statusIcon = "◷";
  } else if (isNew) {
    borderColor = "border-blue-500/30";
    statusColor = "text-blue-400";
    statusIcon = "■";
  }

  return (
    <div className={`bg-[#121212] rounded-xl p-5 border ${borderColor} shadow-xl relative overflow-hidden group`}>

      {/* Header: Status & Title */}
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider mb-1 ${statusColor}`}>
            <span className="text-lg leading-none">{statusIcon}</span>
            <span>{status}</span>
            <span className="text-gray-500 font-normal normal-case">
              • Room {t.room} • {taskType}
            </span>
          </div>
          <div className="text-xs text-gray-500">
            Created {createdTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <div className="text-gray-600 hover:text-white cursor-pointer">•••</div>
      </div>

      {/* SLA / Warning Strip */}
      <div className={`mb-4 px-3 py-2 rounded text-xs border ${isBlocked ? 'bg-red-500/10 border-red-500/20 text-red-400' :
        isInProgress ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
          'bg-blue-500/10 border-blue-500/20 text-blue-400'
        }`}>
        {slaLabel}
      </div>

      {/* Details Grid */}
      <div className="space-y-4 border-t border-white/5 pt-4 mb-4">
        <h4 className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">Task Details</h4>

        <div className="grid grid-cols-[80px_1fr] gap-y-2 text-sm">
          <div className="text-gray-600">Task Type</div>
          <div className="text-gray-300 capitalize">{taskType.replace(/_/g, ' ')}</div>

          <div className="text-gray-600">Request By</div>
          <div className="text-gray-300">
            {header?.requested_by_type || 'Guest'}
            {header?.requested_by_name && (
              <span className="text-gray-500 ml-1 italic">( {header.requested_by_name} )</span>
            )}
          </div>

          <div className="text-gray-600">SLA</div>
          <div className="text-gray-300">{slaLabel}</div>

          <div className="text-gray-600">Priority</div>
          <div className="text-gray-300 uppercase">{priority}</div>
        </div>
      </div>

      {/* Timeline */}
      <div className="space-y-4 border-t border-white/5 pt-4 mb-6">
        <h4 className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">Task Timeline</h4>

        <div className="space-y-4 pl-1">
          {timeline.length > 0 ? timeline.map((event: any, i: number) => (
            <div key={i} className="flex gap-4 relative">
              {/* Vertical Line */}
              {i !== timeline.length - 1 && (
                <div className="absolute left-[2.2rem] top-5 bottom-[-1rem] w-px bg-white/10"></div>
              )}
              <div className="text-xs text-gray-500 font-mono w-8 text-right">
                {new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div>
                <div className="text-gray-300 text-xs font-semibold">{event.title}</div>
                <div className="text-gray-600 text-[10px]">{event.description}</div>
              </div>
            </div>
          )) : (
            <div className="text-xs text-gray-600">No events recorded.</div>
          )}
        </div>
      </div>

      {/* Actions Footer */}
      <div className="grid grid-cols-2 gap-2 mt-2">
        {isNew ? (
          <>
            <button
              onClick={() => onAction(t, 'start')}
              className="py-2 bg-[#1A1C25] hover:bg-white/10 text-white text-xs font-bold uppercase rounded border border-white/10 transition"
            >
              Assign
            </button>
            <button className="py-2 bg-[#1A1C25] hover:bg-white/10 text-white text-xs font-bold uppercase rounded border border-white/10 transition">
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="py-2 bg-[#1A1C25] hover:bg-white/10 text-white text-xs font-bold uppercase rounded border border-white/10 transition">
              Reset
            </button>
            {isInProgress ? (
              <button
                onClick={() => onAction(t, 'resolve')}
                className="py-2 bg-green-900/40 hover:bg-green-900/60 text-green-400 border border-green-500/30 text-xs font-bold uppercase rounded transition"
              >
                Resolve
              </button>
            ) : (
              <button className="py-2 bg-[#1A1C25] hover:bg-white/10 text-white text-xs font-bold uppercase rounded border border-white/10 transition">
                Reassign
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
