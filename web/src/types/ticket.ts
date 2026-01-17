// Production-Grade Types for Staff Task Runner (V1 Schema + Views)

export type TicketStatus = "NEW" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CANCELLED";
export type CreatedBy = "GUEST" | "STAFF" | "SYSTEM" | "FRONT_DESK";
export type HotelRole = "OWNER" | "MANAGER" | "STAFF";

export type TicketEventType =
    | "CREATED"
    | "ASSIGNED"
    | "REASSIGNED"
    | "STARTED"
    | "BLOCKED"
    | "UNBLOCKED"
    | "COMPLETED"
    | "ESCALATED"
    | "RESET"
    | "PING_SUPERVISOR"
    | "BLOCK_UPDATED"
    | "COMMENT_ADDED";

export type ActorType = "STAFF" | "SYSTEM" | "GUEST" | "FRONT_DESK";

export type BlockReasonCode =
    | "guest_inside"
    | "room_locked"
    | "supplies_unavailable"
    | "waiting_maintenance"
    | "supervisor_approval"
    | "shift_ended"
    | "something_else"
    | "GUEST_REQUESTED_LATER";

export interface Department {
    id: string;
    hotel_id: string;
    code: string;
    name: string;
    is_active: boolean;
}

export interface HotelMember {
    id: string;
    hotel_id: string;
    user_id: string;
    role: HotelRole;
    department_id: string;
    is_active: boolean;
    status: string;
    created_at: string;
}

export interface Ticket {
    id: string;
    service_department_id: string;
    room_id: string | null;
    title: string;
    description: string | null;
    status: TicketStatus;
    current_assignee_id: string | null;
    created_by_type: CreatedBy;
    created_by_id: string | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
    cancelled_at: string | null;

    // Joined data
    sla_state?: TicketSLAState;
    department?: Department;
    reason_code?: string | null;
}

export interface TicketSLAState {
    ticket_id: string;
    sla_policy_id: string | null;
    sla_started_at: string | null;
    sla_paused_at: string | null;
    sla_resumed_at: string | null;
    total_paused_seconds: number;
    breached: boolean;
    breached_at: string | null;
    current_remaining_seconds: number | null;
    updated_at: string;
    last_updated_at?: string;
}

export interface TicketEvent {
    id: string;
    ticket_id: string;
    event_type: TicketEventType;
    previous_status: string | null;
    new_status: string | null;
    reason_code: string | null;
    comment: string | null;
    actor_type: ActorType;
    actor_id: string | null;
    created_at: string;
}

export interface BlockReason {
    code: string;
    label: string;
    description?: string;
    requires_comment: boolean;
    pauses_sla: boolean;
    is_active: boolean;
    icon?: string;
    requires_resume_time?: boolean;
}

export interface UnblockReason {
    code: string;
    label: string;
    icon?: string;
    description?: string;
}

// View Model for v_staff_runner_tickets
export interface StaffRunnerTicket {
    ticket_id: string;
    title: string;
    status: TicketStatus;
    department_name: string;
    created_at: string;
    assigned_staff_id: string | null;
    assigned_user_id: string | null;
    assigned_to_name: string;
    sla_target_minutes: number | null;
    sla_remaining_seconds: number | null;
    sla_breached: boolean | null;
    sla_label: string | null;
    sla_state: 'NOT_STARTED' | 'RUNNING' | 'BREACHED' | 'PAUSED' | 'UNKNOWN';
    active_work_seconds: number | null;
    blocked_seconds: number | null;
    requested_by: CreatedBy;
    allowed_actions: "ASSIGN" | "RESET_REASSIGN" | "NONE" | string;
    location_label: string | null;

    // For UI compatibility where needed (optional fields usually joined)
    reason_code?: string | null;
    block_reason_code?: string;
    room_id?: string;
    description: string | null;
}

// API Parameter Types
export interface StartTaskParams {
    ticketId: string;
    note?: string;
}

export interface CompleteTaskParams {
    ticketId: string;
    note?: string;
}

export interface BlockTaskParams {
    ticketId: string;
    reasonCode: string;
    note?: string;
    resumeAfter?: string; // ISO Date string
}

export interface UpdateStatusParams {
    ticketId: string;
    reasonCode: string;
    note: string;
    resume?: boolean;
    resumeAfter?: string; // ISO Date string
}

export interface UnblockTaskParams {
    ticketId: string;
    unblockReasonCode: string; // The reason for unblocking
    note?: string;
}

export interface PingSupervisorParams {
    ticketId: string;
    note?: string;
}

export interface SLAStatus {
    timeRemaining: number;
    isBreached: boolean;
    percentComplete: number;
}

export interface CancelReason {
    code: string;
    label: string;
    description?: string;
    requires_comment: boolean;
    allowed_for_staff: boolean;
    allowed_for_guest: boolean;
    is_active: boolean;
    icon?: string;
}

export interface CancelTicketParams {
    ticketId: string;
    reasonCode: string;
    comment?: string;
}
