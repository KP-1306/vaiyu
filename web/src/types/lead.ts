// web/src/types/lead.ts
//
// TypeScript types for the Lead CRM. Mirrors the DB schema from migrations
// 20260525000001..20260525000008.
//
// Design notes:
//   - All enums declared as string literal unions (matches PG enum behavior).
//   - LeadEventPayloads is a map keyed by event_type (no duplicated discriminant
//     inside payload bodies). Consumers narrow via `event.event_type`.
//   - TransitionMode uses `(string & {})` to accept unknown future values
//     (e.g. 'bulk_import', 'ota_sync') without breaking the type.
//   - All dates from the wire are ISO strings (timestamptz). UI helpers convert
//     to Date when needed.
//   - Optional fields use `?` (not `| undefined`) to match codebase convention.
//   - event_schema_version is per-row from the lead_events table; allows
//     forward-compat for breaking payload changes.

// ─── Enums ────────────────────────────────────────────────────────────────

export type LeadStatus =
  | 'NEW'
  | 'QUALIFIED'
  | 'QUOTED'
  | 'WON'
  | 'CONVERTED'
  | 'LOST';

export type LeadSource =
  | 'GOOGLE'
  | 'WEBSITE'
  | 'INSTAGRAM'
  | 'FACEBOOK'
  | 'OTA'
  | 'WALK_IN'
  | 'REFERRAL'
  | 'AGENT'
  | 'CORPORATE'
  | 'WEDDING'
  | 'GROUP'
  | 'OTHER';

export type LeadEventType =
  | 'CREATED'
  | 'STATUS_CHANGED'
  | 'ASSIGNED'
  | 'UNASSIGNED'
  | 'CLAIMED'
  | 'CLAIM_RELEASED'
  | 'NOTE_ADDED'
  | 'TAG_ADDED'
  | 'TAG_REMOVED'
  | 'CONTACT_UPDATED'
  | 'BASICS_UPDATED'
  | 'QUOTE_SENT'
  | 'CONVERTED_TO_BOOKING'
  | 'SOFT_DELETED'
  | 'REOPENED';

export type ReleaseType = 'manual' | 'forced' | 'auto_on_convert';

// Open union — known values for autocomplete, accepts future strings from backend
// without requiring a type bump (e.g., 'bulk_import', 'ota_sync').
// The `(string & {})` trick preserves IDE autocomplete for the literal values.
export type TransitionMode = 'manual' | 'auto_convert' | (string & {});

// ─── Allowed state transitions (mirrors transition_lead_status RPC) ────────

export const ALLOWED_TRANSITIONS: Readonly<Record<LeadStatus, readonly LeadStatus[]>> = {
  NEW: ['QUALIFIED', 'QUOTED', 'WON', 'LOST'],
  QUALIFIED: ['QUOTED', 'WON', 'LOST'],
  QUOTED: ['WON', 'LOST'],
  WON: ['CONVERTED', 'LOST'],
  CONVERTED: [],
  LOST: ['NEW'],
} as const;

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] as readonly LeadStatus[]).includes(to);
}

// ─── Lead row ─────────────────────────────────────────────────────────────

export interface Lead {
  id: string;
  hotel_id: string;

  source: LeadSource;
  source_detail: string | null;
  partner_id: string | null;

  contact_name: string;
  contact_phone: string | null;
  contact_phone_normalized: string | null;
  contact_email: string | null;

  requested_check_in: string | null;
  requested_check_out: string | null;
  party_adults: number;
  party_children: number;
  room_count: number;
  value_estimate: number | null;

  status: LeadStatus;
  status_reason: string | null;
  assigned_to: string | null;

  claimed_by: string | null;
  claimed_at: string | null;

  converted_booking_id: string | null;
  won_at: string | null;
  converted_at: string | null;

  latest_note_preview: string | null;
  tags: string[];

  created_at: string;
  created_by: string | null;
  updated_at: string;
  last_activity_at: string;
  deleted_at: string | null;
}

// ─── Event payload shapes (keyed by event_type — NO duplicated discriminant) ─

export interface LeadEventPayloads {
  CREATED: {
    source: string;
    source_detail: string | null;
    actor_role: string;
    has_phone: boolean;
    has_email: boolean;
    by_user_name?: string;          // Day 9: snapshotted (optional for old events)
  };
  STATUS_CHANGED: {
    from: LeadStatus;
    to: LeadStatus;
    reason: string | null;
    converted_booking_id: string | null;
    actor_role: string;
    auto_promoted?: boolean;
    transition_mode?: TransitionMode;
    conversion_started_from?: LeadStatus;
    by_user_name?: string;          // Day 9
  };
  ASSIGNED: {
    to_user: string;
    to_user_name?: string;          // Day 9
    prev_user: string | null;
    prev_user_name?: string | null; // Day 9
    by_user: string;
    by_user_name?: string;          // Day 9
  };
  UNASSIGNED: {
    from_user: string;
    from_user_name?: string;        // Day 9
    by_user: string;
    by_user_name?: string;          // Day 9
  };
  CLAIMED: {
    by_user: string;
    by_user_name: string;
    prev_user: string | null;
    prev_user_name: string | null;
    expires_at: string;
    took_over_expired: boolean;
  };
  CLAIM_RELEASED: {
    by_user: string;
    by_user_name: string;
    prev_holder: string;
    prev_holder_name: string;
    release_type: ReleaseType;
    reason: string | null;
    actor_role: string | null;
  };
  NOTE_ADDED: {
    text: string;
    by_user_name?: string;          // Day 9
  };
  TAG_ADDED: {
    tag: string;
  };
  TAG_REMOVED: {
    tag: string;
  };
  CONTACT_UPDATED: {
    changes: Record<string, [unknown, unknown]>;
    by_user_name?: string;          // Day 9
  };
  BASICS_UPDATED: {
    changes: Record<string, [unknown, unknown]>;
    by_user_name?: string;          // Day 9
  };
  QUOTE_SENT: {
    quote_id: string;
    channel: 'EMAIL' | 'WHATSAPP';
  };
  CONVERTED_TO_BOOKING: {
    booking_id: string;
    booking_code: string;
    from_status: LeadStatus;
    promoted_through: LeadStatus[];
    by_user: string;
    by_user_name: string;
    actor_role: string;
    conversion_origin: string;
    conversion_latency_ms?: number;
  };
  SOFT_DELETED: {
    reason: string | null;
    actor_role: string;
    by_user_name?: string;          // Day 9
  };
  REOPENED: {
    previous_reason: string | null;
    by_user_name?: string;          // Day 9
  };
}

// Generic LeadEvent — payload typed by event_type via mapped lookup.
// Use a discriminated union via narrowing on event.event_type to access
// the specific payload shape.
export type LeadEvent = {
  [K in LeadEventType]: {
    id: string;
    lead_id: string;
    hotel_id: string;
    event_type: K;
    event_schema_version: number;
    payload: LeadEventPayloads[K];
    actor_id: string | null;
    occurred_at: string;
  };
}[LeadEventType];

// Convenience type-narrowed event: useful when you know the type up front.
export type LeadEventOf<K extends LeadEventType> = Extract<LeadEvent, { event_type: K }>;

// ─── RPC input shapes ─────────────────────────────────────────────────────

export interface CreateLeadInput {
  hotelId: string;
  source: LeadSource;
  contactName: string;
  sourceDetail?: string;
  contactPhone?: string;
  contactEmail?: string;
  checkIn?: string;
  checkOut?: string;
  partyAdults?: number;
  partyChildren?: number;
  roomCount?: number;
  valueEstimate?: number;
  notes?: string;
  tags?: string[];
}

export interface UpdateLeadContactInput {
  name?: string;
  phone?: string;
  email?: string;
}

export interface UpdateLeadBasicsInput {
  checkIn?: string;
  checkOut?: string;
  partyAdults?: number;
  partyChildren?: number;
  roomCount?: number;
  valueEstimate?: number;
  sourceDetail?: string;
  tags?: string[];
}

export interface WalkinArgs {
  guest_details: {
    full_name: string;
    phone?: string;
    email?: string;
    [key: string]: unknown;
  };
  room_selections: Array<{
    room_id: string;
    room_type_id: string;
    amount_per_night: number;
    discount_per_night?: number;
    [key: string]: unknown;
  }>;
  checkin_date: string;
  checkout_date: string;
  adults?: number;
  children?: number;
}

// ─── RPC return shapes ────────────────────────────────────────────────────

export interface CreateLeadResult {
  lead_id: string;
  duplicate_warning: {
    recent_lead_id: string;
    recent_status: LeadStatus;
    days_ago: number;
  } | null;
}

export interface ClaimStatus {
  ok: boolean;
  claimed_by: string | null;
  claimed_by_name: string | null;
  claimed_at: string | null;
  claim_expires_at: string | null;
  is_expired: boolean;
  is_self: boolean;
}

export interface ReleaseClaimResult extends ClaimStatus {
  released: boolean;
}

export interface ForceReleaseClaimResult extends ReleaseClaimResult {
  release_type?: ReleaseType;
}

export interface ConvertResult {
  ok: true;
  booking_id: string;
  booking_code: string;
  from_status: LeadStatus;
  promoted_through: LeadStatus[];
  conversion_latency_ms?: number;
}

// ─── Filters / query inputs ───────────────────────────────────────────────

export type LeadOrderBy = 'last_activity_at' | 'created_at' | 'value_estimate';
export type LeadOrderDir = 'asc' | 'desc';

export interface LeadListFilters {
  status?: LeadStatus[];
  source?: LeadSource[];
  assignedTo?: string | null;
  search?: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: LeadOrderBy;
  orderDir?: LeadOrderDir;
}

// ─── Error codes (mirror RPC RAISE EXCEPTION strings + frontend-specific) ─

export const LEAD_ERROR_CODES = [
  // Auth + lookup
  'NOT_AUTHORIZED',
  'LEAD_NOT_FOUND',
  'LEAD_DELETED',
  // Input validation
  'INVALID_CONTACT',
  'INVALID_NAME',
  'INVALID_DATES',
  'INVALID_PARTY',
  // State machine
  'INVALID_TRANSITION',
  'REASON_REQUIRED',
  'BOOKING_REQUIRED',
  'BOOKING_NOT_FOUND',
  'BOOKING_MISMATCH',
  'BOOKING_HOTEL_MISMATCH',
  'BOOKING_CREATION_FAILED',
  // Assignment + notes
  'ASSIGNEE_NOT_MEMBER',
  'NOTE_EMPTY',
  // Conversion
  'ALREADY_CONVERTED',
  'LEAD_IS_LOST',
  // Walk-in args validation
  'WALKIN_ARGS_REQUIRED',
  'WALKIN_ARGS_INCOMPLETE',
  'GUEST_DETAILS_MUST_BE_OBJECT',
  'GUEST_NAME_REQUIRED',
  'ROOM_SELECTIONS_MUST_BE_ARRAY',
  'ROOM_SELECTIONS_EMPTY',
  'INVALID_CHECKIN_DATE_FORMAT',
  'INVALID_CHECKOUT_DATE_FORMAT',
  // Frontend-specific
  'SESSION_EXPIRED',
  'UNKNOWN_ERROR',
] as const;

export type LeadErrorCode = (typeof LEAD_ERROR_CODES)[number];

// Structured detail shapes for specific error codes
export interface AlreadyConvertedDetail {
  existing_booking_id: string;
  existing_booking_code: string;
}
