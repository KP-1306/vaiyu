// web/src/services/leadService.ts
//
// Sole API boundary for the Lead CRM. UI components must call this service —
// never supabase.rpc / supabase.from directly. Bypassing fragments error
// handling, makes mocking impossible, and lets payload shapes drift.
//
// Responsibilities:
//   - Wrap every Lead CRM RPC with typed input + output
//   - Normalize Postgrest errors into LeadServiceError with stable codes
//   - Validate realtime payloads at runtime (forward-compat for unknown types)
//   - List + read helpers for Lead + LeadEvent
//
// Realtime subscriptions live in hooks/useLeadsRealtime.ts and
// useLeadEventsRealtime.ts. The service exposes the validator + types they
// consume.

import { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { addBreadcrumb, captureMessage } from '../lib/monitoring';
import type {
  Lead,
  LeadEvent,
  LeadEventType,
  LeadEventPayloads,
  LeadStatus,
  LeadListFilters,
  CreateLeadInput,
  CreateLeadResult,
  UpdateLeadContactInput,
  UpdateLeadBasicsInput,
  WalkinArgs,
  ClaimStatus,
  ReleaseClaimResult,
  ForceReleaseClaimResult,
  ConvertResult,
  LeadErrorCode,
} from '../types/lead';
import { LEAD_ERROR_CODES } from '../types/lead';

// ─── LeadServiceError ─────────────────────────────────────────────────────

export class LeadServiceError extends Error {
  constructor(
    public readonly code: LeadErrorCode,
    message: string,
    public readonly details: unknown = null,
    public readonly hint: string | null = null,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LeadServiceError';
  }

  /** Type guard for ALREADY_CONVERTED structured details. */
  isAlreadyConverted(): this is LeadServiceError & {
    details: { existing_booking_id: string; existing_booking_code: string };
  } {
    return (
      this.code === 'ALREADY_CONVERTED' &&
      typeof this.details === 'object' &&
      this.details !== null &&
      'existing_booking_id' in this.details &&
      'existing_booking_code' in this.details
    );
  }
}

const ERROR_CODE_SET = new Set<LeadErrorCode>(LEAD_ERROR_CODES);

/** Parse a PostgrestError or generic Error into LeadServiceError. */
export function fromPostgrestError(err: unknown): LeadServiceError {
  // Network / generic Error
  if (!err || typeof err !== 'object') {
    return new LeadServiceError('UNKNOWN_ERROR', String(err), null, null, err);
  }

  const anyErr = err as Partial<PostgrestError> & {
    status?: number;
    statusCode?: number;
    message?: string;
    details?: string;
    hint?: string;
    code?: string;
  };

  // HTTP 401 → session expired
  const status = anyErr.status ?? anyErr.statusCode;
  if (status === 401) {
    return new LeadServiceError(
      'SESSION_EXPIRED',
      'Your session has expired. Please sign in again.',
      null,
      null,
      err,
    );
  }

  // SQLSTATE-based mappings (PostgrestError.code is the SQLSTATE)
  if (anyErr.code === '42501') {
    return new LeadServiceError(
      'NOT_AUTHORIZED',
      anyErr.message ?? 'Not authorized',
      null,
      null,
      err,
    );
  }

  // Parse our RAISE EXCEPTION codes from message
  const rawMessage = (anyErr.message ?? '').trim();
  // Many of our raises have the form 'CODE' or 'CODE: extra detail'.
  // The first token (split on `:` or whitespace) is the candidate code.
  const codeMatch = rawMessage.match(/^([A-Z][A-Z0-9_]*)/);
  const candidate = codeMatch?.[1];

  if (candidate && ERROR_CODE_SET.has(candidate as LeadErrorCode)) {
    const code = candidate as LeadErrorCode;
    let parsedDetails: unknown = null;

    // Special case: INVALID_TRANSITION encodes from/to in the message itself
    // ("INVALID_TRANSITION: NEW -> CONVERTED"). Extract before falling back to DETAIL.
    if (code === 'INVALID_TRANSITION') {
      const m = rawMessage.match(/INVALID_TRANSITION:\s*(\w+)\s*->\s*(\w+)/);
      if (m) {
        parsedDetails = { from: m[1], to: m[2] };
      }
    }

    // Otherwise parse structured DETAIL field (we encode JSON for ALREADY_CONVERTED etc.)
    if (parsedDetails === null && anyErr.details) {
      try {
        parsedDetails = JSON.parse(anyErr.details);
      } catch {
        parsedDetails = anyErr.details;
      }
    }

    return new LeadServiceError(
      code,
      rawMessage,
      parsedDetails,
      anyErr.hint ?? null,
      err,
    );
  }

  return new LeadServiceError(
    'UNKNOWN_ERROR',
    rawMessage || 'An unknown error occurred',
    anyErr.details ?? null,
    anyErr.hint ?? null,
    err,
  );
}

// ─── Internal: callRpc ────────────────────────────────────────────────────

/** Slow-query dev warning threshold. */
const SLOW_QUERY_MS = 200;

async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const start = performance.now();
  const { data, error } = await supabase.rpc(name, args);
  const duration_ms = Math.round(performance.now() - start);

  if (error) {
    const wrapped = fromPostgrestError(error);
    addBreadcrumb({
      category: 'leadService',
      message: `${name} failed: ${wrapped.code}`,
      level: 'error',
      data: { rpc: name, code: wrapped.code, hint: wrapped.hint, duration_ms },
    });
    throw wrapped;
  }

  addBreadcrumb({
    category: 'leadService',
    message: `${name} ok`,
    level: 'info',
    data: { rpc: name, duration_ms },
  });
  if (import.meta.env.DEV && duration_ms > SLOW_QUERY_MS) {
    // eslint-disable-next-line no-console
    console.debug(`[leadService] slow rpc: ${name} took ${duration_ms}ms`);
  }
  return data as T;
}

/** Wrap a Postgrest query call with the same telemetry shape as callRpc. */
async function timedRead<T>(
  label: string,
  run: () => Promise<{ data: T | null; error: unknown; count?: number | null }>,
): Promise<{ data: T | null; count?: number | null }> {
  const start = performance.now();
  const { data, error, count } = await run();
  const duration_ms = Math.round(performance.now() - start);
  if (error) {
    const wrapped = fromPostgrestError(error);
    addBreadcrumb({
      category: 'leadService',
      message: `${label} failed: ${wrapped.code}`,
      level: 'error',
      data: { read: label, code: wrapped.code, duration_ms },
    });
    throw wrapped;
  }
  addBreadcrumb({
    category: 'leadService',
    message: `${label} ok`,
    level: 'info',
    data: { read: label, rows: Array.isArray(data) ? data.length : data ? 1 : 0, duration_ms },
  });
  if (import.meta.env.DEV && duration_ms > SLOW_QUERY_MS) {
    // eslint-disable-next-line no-console
    console.debug(`[leadService] slow read: ${label} took ${duration_ms}ms`);
  }
  return { data, count };
}

// ─── Service: lifecycle ───────────────────────────────────────────────────

export async function createLead(input: CreateLeadInput): Promise<CreateLeadResult> {
  return callRpc<CreateLeadResult>('create_lead', {
    p_hotel_id: input.hotelId,
    p_source: input.source,
    p_contact_name: input.contactName,
    p_source_detail: input.sourceDetail ?? null,
    p_contact_phone: input.contactPhone ?? null,
    p_contact_email: input.contactEmail ?? null,
    p_check_in: input.checkIn ?? null,
    p_check_out: input.checkOut ?? null,
    p_party_adults: input.partyAdults ?? 1,
    p_party_children: input.partyChildren ?? 0,
    p_room_count: input.roomCount ?? 1,
    p_value_estimate: input.valueEstimate ?? null,
    p_notes: input.notes ?? null,
    p_tags: input.tags ?? [],
  });
}

export async function transitionLeadStatus(
  leadId: string,
  toStatus: LeadStatus,
  opts: { reason?: string; convertedBookingId?: string } = {},
): Promise<void> {
  await callRpc<void>('transition_lead_status', {
    p_lead_id: leadId,
    p_to_status: toStatus,
    p_reason: opts.reason ?? null,
    p_converted_booking_id: opts.convertedBookingId ?? null,
  });
}

export async function assignLead(leadId: string, userId: string | null): Promise<void> {
  await callRpc<void>('assign_lead', {
    p_lead_id: leadId,
    p_user_id: userId,
  });
}

export async function softDeleteLead(leadId: string, reason?: string): Promise<void> {
  await callRpc<void>('soft_delete_lead', {
    p_lead_id: leadId,
    p_reason: reason ?? null,
  });
}

export async function updateLeadContact(
  leadId: string,
  updates: UpdateLeadContactInput,
): Promise<void> {
  await callRpc<void>('update_lead_contact', {
    p_lead_id: leadId,
    p_name: updates.name ?? null,
    p_phone: updates.phone ?? null,
    p_email: updates.email ?? null,
  });
}

export async function updateLeadBasics(
  leadId: string,
  updates: UpdateLeadBasicsInput,
): Promise<void> {
  await callRpc<void>('update_lead_basics', {
    p_lead_id: leadId,
    p_check_in: updates.checkIn ?? null,
    p_check_out: updates.checkOut ?? null,
    p_party_adults: updates.partyAdults ?? null,
    p_party_children: updates.partyChildren ?? null,
    p_room_count: updates.roomCount ?? null,
    p_value_estimate: updates.valueEstimate ?? null,
    p_source_detail: updates.sourceDetail ?? null,
    p_tags: updates.tags ?? null,
  });
}

export async function addLeadNote(leadId: string, text: string): Promise<string> {
  return callRpc<string>('add_lead_note', {
    p_lead_id: leadId,
    p_text: text,
  });
}

// ─── Service: claim lock ──────────────────────────────────────────────────

export async function claimLead(leadId: string): Promise<ClaimStatus> {
  return callRpc<ClaimStatus>('claim_lead', { p_lead_id: leadId });
}

export async function releaseClaim(leadId: string): Promise<ReleaseClaimResult> {
  return callRpc<ReleaseClaimResult>('release_claim', { p_lead_id: leadId });
}

export async function forceReleaseClaim(
  leadId: string,
  reason: string,
): Promise<ForceReleaseClaimResult> {
  return callRpc<ForceReleaseClaimResult>('force_release_claim', {
    p_lead_id: leadId,
    p_reason: reason,
  });
}

export async function getLeadClaimStatus(leadId: string): Promise<ClaimStatus> {
  return callRpc<ClaimStatus>('get_lead_claim_status', { p_lead_id: leadId });
}

// ─── Service: conversion ──────────────────────────────────────────────────

export async function convertLeadToWalkin(
  leadId: string,
  walkinArgs: WalkinArgs,
): Promise<ConvertResult> {
  return callRpc<ConvertResult>('convert_lead_to_walkin', {
    p_lead_id: leadId,
    p_walkin_args: walkinArgs,
  });
}

// ─── Service: reads ───────────────────────────────────────────────────────

export interface ListLeadsResult {
  leads: Lead[];
  total: number | null;
}

export interface ListLeadsFilters extends LeadListFilters {
  /** When true, request Supabase exact count. Returned as `total`. */
  includeCount?: boolean;
  /** When true, ORDER BY value_estimate places NULLs at the end (sane for "highest first"). */
  nullsLast?: boolean;
}

export async function listLeads(
  hotelId: string,
  filters: ListLeadsFilters = {},
): Promise<ListLeadsResult> {
  const selectOpts = filters.includeCount ? { count: 'exact' as const } : undefined;
  let query = selectOpts
    ? supabase.from('leads').select('*', selectOpts)
    : supabase.from('leads').select('*');

  query = query.eq('hotel_id', hotelId);

  if (!filters.includeDeleted) {
    query = query.is('deleted_at', null);
  }
  if (filters.status && filters.status.length > 0) {
    query = query.in('status', filters.status);
  }
  if (filters.source && filters.source.length > 0) {
    query = query.in('source', filters.source);
  }
  if (filters.assignedTo === null) {
    query = query.is('assigned_to', null);
  } else if (filters.assignedTo) {
    query = query.eq('assigned_to', filters.assignedTo);
  }
  if (filters.search) {
    const term = `%${filters.search}%`;
    // Search across name, raw phone, normalized phone, email. The normalized
    // column means "9876543210" matches "+91 98765 43210" (Day 7 fix).
    query = query.or(
      `contact_name.ilike.${term},contact_phone.ilike.${term},contact_phone_normalized.ilike.${term},contact_email.ilike.${term}`,
    );
  }

  const orderBy = filters.orderBy ?? 'last_activity_at';
  const orderDir = filters.orderDir ?? 'desc';
  const ascending = orderDir === 'asc';

  // nullsFirst:false => NULLs last regardless of direction. Used for
  // value_estimate sort (avoids "highest value first" putting NULLs at top).
  if (filters.nullsLast) {
    query = query.order(orderBy, { ascending, nullsFirst: false });
  } else {
    query = query.order(orderBy, { ascending });
  }

  // Stable tie-breaker — without this, equal sort values can cause pagination
  // to duplicate or skip rows across pages.
  query = query.order('id', { ascending: false });

  if (typeof filters.limit === 'number') query = query.limit(filters.limit);
  if (typeof filters.offset === 'number') {
    query = query.range(filters.offset, filters.offset + (filters.limit ?? 50) - 1);
  }

  const { data, count } = await timedRead<Lead[]>('listLeads', async () => {
    const { data, error, count } = await query;
    return { data, error, count };
  });

  return {
    leads: (data ?? []) as Lead[],
    total: typeof count === 'number' ? count : null,
  };
}

export async function getLead(leadId: string): Promise<Lead | null> {
  const { data } = await timedRead<Lead>('getLead', async () => {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .maybeSingle();
    return { data, error };
  });
  return (data ?? null) as Lead | null;
}

export async function getLeadEvents(
  leadId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<LeadEvent[]> {
  let query = supabase
    .from('lead_events')
    .select('*')
    .eq('lead_id', leadId)
    .order('occurred_at', { ascending: false });

  if (opts.before) {
    query = query.lt('occurred_at', opts.before);
  }
  query = query.limit(opts.limit ?? 100);

  const { data } = await timedRead<unknown[]>('getLeadEvents', async () => {
    const { data, error } = await query;
    return { data, error };
  });

  const validated: LeadEvent[] = [];
  for (const raw of data ?? []) {
    const event = validateLeadEventRow(raw);
    if (event) validated.push(event);
  }
  return validated;
}

// ─── Realtime payload validation ──────────────────────────────────────────

export const KNOWN_MAX_SCHEMA_VERSION = 1;

type PayloadValidator<K extends LeadEventType> = (
  raw: unknown,
) => LeadEventPayloads[K] | null;

// Helper: is the value a plain object?
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Helper: optional accessor with type check
function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function asStringOrNull(v: unknown): string | null {
  return v === null ? null : typeof v === 'string' ? v : null;
}
function asNumberOrNull(v: unknown): number | null {
  return v === null ? null : typeof v === 'number' ? v : null;
}
function asBool(v: unknown): boolean {
  return typeof v === 'boolean' ? v : false;
}

// Per-event-type validators. Adding a new event type requires:
//   1. Add to LeadEventType union (types/lead.ts)
//   2. Add payload shape to LeadEventPayloads (types/lead.ts)
//   3. Add validator entry below
const PAYLOAD_VALIDATORS: {
  [K in LeadEventType]: PayloadValidator<K>;
} = {
  CREATED: (raw) => {
    if (!isObject(raw)) return null;
    if (typeof raw.source !== 'string') return null;
    return {
      source: raw.source,
      source_detail: asStringOrNull(raw.source_detail),
      actor_role: asString(raw.actor_role) ?? 'UNKNOWN',
      has_phone: asBool(raw.has_phone),
      has_email: asBool(raw.has_email),
      by_user_name: typeof raw.by_user_name === 'string' ? raw.by_user_name : undefined,
    };
  },
  STATUS_CHANGED: (raw) => {
    if (!isObject(raw)) return null;
    if (typeof raw.from !== 'string' || typeof raw.to !== 'string') return null;
    return {
      from: raw.from as LeadStatus,
      to: raw.to as LeadStatus,
      reason: asStringOrNull(raw.reason),
      converted_booking_id: asStringOrNull(raw.converted_booking_id),
      actor_role: asString(raw.actor_role) ?? 'UNKNOWN',
      auto_promoted: typeof raw.auto_promoted === 'boolean' ? raw.auto_promoted : undefined,
      transition_mode:
        typeof raw.transition_mode === 'string' ? raw.transition_mode : undefined,
      conversion_started_from:
        typeof raw.conversion_started_from === 'string'
          ? (raw.conversion_started_from as LeadStatus)
          : undefined,
      by_user_name: typeof raw.by_user_name === 'string' ? raw.by_user_name : undefined,
    };
  },
  ASSIGNED: (raw) => {
    if (!isObject(raw)) return null;
    if (typeof raw.to_user !== 'string' || typeof raw.by_user !== 'string') return null;
    return {
      to_user: raw.to_user,
      to_user_name: typeof raw.to_user_name === 'string' ? raw.to_user_name : undefined,
      prev_user: asStringOrNull(raw.prev_user),
      prev_user_name:
        typeof raw.prev_user_name === 'string' ? raw.prev_user_name : raw.prev_user_name === null ? null : undefined,
      by_user: raw.by_user,
      by_user_name: typeof raw.by_user_name === 'string' ? raw.by_user_name : undefined,
    };
  },
  UNASSIGNED: (raw) => {
    if (!isObject(raw)) return null;
    if (typeof raw.from_user !== 'string' || typeof raw.by_user !== 'string') return null;
    return {
      from_user: raw.from_user,
      from_user_name: typeof raw.from_user_name === 'string' ? raw.from_user_name : undefined,
      by_user: raw.by_user,
      by_user_name: typeof raw.by_user_name === 'string' ? raw.by_user_name : undefined,
    };
  },
  CLAIMED: (raw) => {
    if (!isObject(raw)) return null;
    if (
      typeof raw.by_user !== 'string' ||
      typeof raw.by_user_name !== 'string' ||
      typeof raw.expires_at !== 'string'
    )
      return null;
    return {
      by_user: raw.by_user,
      by_user_name: raw.by_user_name,
      prev_user: asStringOrNull(raw.prev_user),
      prev_user_name: asStringOrNull(raw.prev_user_name),
      expires_at: raw.expires_at,
      took_over_expired: asBool(raw.took_over_expired),
    };
  },
  CLAIM_RELEASED: (raw) => {
    if (!isObject(raw)) return null;
    if (
      typeof raw.by_user !== 'string' ||
      typeof raw.prev_holder !== 'string' ||
      typeof raw.release_type !== 'string'
    )
      return null;
    return {
      by_user: raw.by_user,
      by_user_name: asString(raw.by_user_name) ?? 'unknown',
      prev_holder: raw.prev_holder,
      prev_holder_name: asString(raw.prev_holder_name) ?? 'unknown',
      release_type: raw.release_type as LeadEventPayloads['CLAIM_RELEASED']['release_type'],
      reason: asStringOrNull(raw.reason),
      actor_role: asStringOrNull(raw.actor_role),
    };
  },
  NOTE_ADDED: (raw) => {
    if (!isObject(raw) || typeof raw.text !== 'string') return null;
    return {
      text: raw.text,
      by_user_name: typeof raw.by_user_name === 'string' ? raw.by_user_name : undefined,
    };
  },
  TAG_ADDED: (raw) => {
    if (!isObject(raw) || typeof raw.tag !== 'string') return null;
    return { tag: raw.tag };
  },
  TAG_REMOVED: (raw) => {
    if (!isObject(raw) || typeof raw.tag !== 'string') return null;
    return { tag: raw.tag };
  },
  CONTACT_UPDATED: (raw) => {
    if (!isObject(raw) || !isObject(raw.changes)) return null;
    return {
      changes: raw.changes as Record<string, [unknown, unknown]>,
      by_user_name: typeof raw.by_user_name === 'string' ? raw.by_user_name : undefined,
    };
  },
  BASICS_UPDATED: (raw) => {
    if (!isObject(raw) || !isObject(raw.changes)) return null;
    return {
      changes: raw.changes as Record<string, [unknown, unknown]>,
      by_user_name: typeof raw.by_user_name === 'string' ? raw.by_user_name : undefined,
    };
  },
  QUOTE_SENT: (raw) => {
    if (!isObject(raw)) return null;
    if (typeof raw.quote_id !== 'string') return null;
    const channel = raw.channel;
    if (channel !== 'EMAIL' && channel !== 'WHATSAPP') return null;
    return { quote_id: raw.quote_id, channel };
  },
  CONVERTED_TO_BOOKING: (raw) => {
    if (!isObject(raw)) return null;
    if (
      typeof raw.booking_id !== 'string' ||
      typeof raw.booking_code !== 'string' ||
      typeof raw.from_status !== 'string'
    )
      return null;
    return {
      booking_id: raw.booking_id,
      booking_code: raw.booking_code,
      from_status: raw.from_status as LeadStatus,
      promoted_through: Array.isArray(raw.promoted_through)
        ? (raw.promoted_through as LeadStatus[])
        : [],
      by_user: asString(raw.by_user) ?? '',
      by_user_name: asString(raw.by_user_name) ?? 'unknown',
      actor_role: asString(raw.actor_role) ?? 'UNKNOWN',
      conversion_origin: asString(raw.conversion_origin) ?? 'unknown',
      conversion_latency_ms:
        typeof raw.conversion_latency_ms === 'number' ? raw.conversion_latency_ms : undefined,
    };
  },
  SOFT_DELETED: (raw) => {
    if (!isObject(raw)) return null;
    return {
      reason: asStringOrNull(raw.reason),
      actor_role: asString(raw.actor_role) ?? 'UNKNOWN',
      by_user_name: typeof raw.by_user_name === 'string' ? raw.by_user_name : undefined,
    };
  },
  REOPENED: (raw) => {
    if (!isObject(raw)) return null;
    return {
      previous_reason: asStringOrNull(raw.previous_reason),
      by_user_name: typeof raw.by_user_name === 'string' ? raw.by_user_name : undefined,
    };
  },
};

/**
 * Validate a raw lead_events row from Postgrest/realtime into a typed LeadEvent.
 * Returns null on:
 *   - unknown event_type (forward-compat: old client sees new event type)
 *   - schema_version > KNOWN_MAX_SCHEMA_VERSION (forward-compat: breaking change)
 *   - malformed payload (won't crash; logged as warning)
 *
 * Validation failures are logged to Sentry as warnings, not errors —
 * they're expected during staged rollouts.
 */
export function validateLeadEventRow(raw: unknown): LeadEvent | null {
  if (!isObject(raw)) return null;
  if (
    typeof raw.id !== 'string' ||
    typeof raw.lead_id !== 'string' ||
    typeof raw.hotel_id !== 'string' ||
    typeof raw.event_type !== 'string' ||
    typeof raw.occurred_at !== 'string'
  ) {
    return null;
  }

  const eventType = raw.event_type as LeadEventType;
  const schemaVersion =
    typeof raw.event_schema_version === 'number' ? raw.event_schema_version : 1;

  if (schemaVersion > KNOWN_MAX_SCHEMA_VERSION) {
    captureMessage(
      'leadService.unknown_schema_version',
      'warning',
      { eventType, schemaVersion, eventId: raw.id },
    );
    return null;
  }

  const validator = PAYLOAD_VALIDATORS[eventType];
  if (!validator) {
    captureMessage(
      'leadService.unknown_event_type',
      'warning',
      { eventType, eventId: raw.id },
    );
    return null;
  }

  const payload = validator(raw.payload);
  if (!payload) {
    captureMessage(
      'leadService.malformed_event_payload',
      'warning',
      { eventType, eventId: raw.id, schemaVersion },
    );
    return null;
  }

  return {
    id: raw.id,
    lead_id: raw.lead_id,
    hotel_id: raw.hotel_id,
    event_type: eventType,
    event_schema_version: schemaVersion,
    payload,
    actor_id: asStringOrNull(raw.actor_id),
    occurred_at: raw.occurred_at,
  } as LeadEvent;
}
