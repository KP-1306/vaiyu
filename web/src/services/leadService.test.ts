// web/src/services/leadService.test.ts
//
// 100% critical-path coverage for leadService:
//   - LeadServiceError class + type guards
//   - fromPostgrestError mapping (HTTP status, SQLSTATE, message parsing, DETAIL JSON)
//   - Every RPC function: correct rpc name + args + return shape
//   - listLeads / getLead / getLeadEvents query construction
//   - validateLeadEventRow: each event type validator + edge cases
//   - Unknown event_type and unknown schema_version handled gracefully

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────

const rpcMock = vi.fn();
const fromBuilderMock = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => rpcMock(name, args),
    from: (table: string) => fromBuilderMock(table),
  },
}));

const captureMessageMock = vi.fn();
const addBreadcrumbMock = vi.fn();
vi.mock('../lib/monitoring', () => ({
  addBreadcrumb: (...args: unknown[]) => addBreadcrumbMock(...args),
  captureException: vi.fn(),
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

// Imports AFTER mocks
import {
  LeadServiceError,
  fromPostgrestError,
  createLead,
  transitionLeadStatus,
  assignLead,
  softDeleteLead,
  updateLeadContact,
  updateLeadBasics,
  addLeadNote,
  claimLead,
  releaseClaim,
  forceReleaseClaim,
  getLeadClaimStatus,
  convertLeadToWalkin,
  listLeads,
  getLead,
  getLeadEvents,
  validateLeadEventRow,
  KNOWN_MAX_SCHEMA_VERSION,
} from './leadService';
import type { LeadEventPayloads } from '../types/lead';

beforeEach(() => {
  rpcMock.mockReset();
  fromBuilderMock.mockReset();
  captureMessageMock.mockReset();
  addBreadcrumbMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// Helper: build a chainable Postgrest query mock with terminal { data, error, count? }
function buildQueryMock(result: { data: unknown; error: unknown; count?: number | null }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  const chainMethods = [
    'select', 'eq', 'neq', 'is', 'in', 'lt', 'gt', 'gte', 'lte',
    'or', 'order', 'limit', 'range',
  ];
  for (const m of chainMethods) {
    builder[m] = vi.fn(() => builder as unknown as Record<string, unknown>);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  // The terminal step: when the chain is awaited it must resolve.
  // Postgrest builders are thenable — implement .then() so `await query`
  // returns the result.
  (builder as unknown as { then: unknown }).then = (
    onFulfilled: (v: typeof result) => unknown,
  ) => Promise.resolve(result).then(onFulfilled);
  return builder;
}

// ─── LeadServiceError ─────────────────────────────────────────────────────

describe('LeadServiceError', () => {
  it('stores code, details, hint, cause', () => {
    const cause = new Error('original');
    const err = new LeadServiceError('NOT_AUTHORIZED', 'msg', { x: 1 }, 'hint', cause);
    expect(err.code).toBe('NOT_AUTHORIZED');
    expect(err.message).toBe('msg');
    expect(err.details).toEqual({ x: 1 });
    expect(err.hint).toBe('hint');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('LeadServiceError');
  });

  it('isAlreadyConverted narrows when code + structured details match', () => {
    const err = new LeadServiceError(
      'ALREADY_CONVERTED',
      'msg',
      { existing_booking_id: 'b1', existing_booking_code: 'W-1' },
    );
    expect(err.isAlreadyConverted()).toBe(true);
    if (err.isAlreadyConverted()) {
      expect(err.details.existing_booking_id).toBe('b1');
      expect(err.details.existing_booking_code).toBe('W-1');
    }
  });

  it('isAlreadyConverted returns false when code mismatches', () => {
    const err = new LeadServiceError('NOT_AUTHORIZED', 'msg', {
      existing_booking_id: 'b1',
      existing_booking_code: 'W-1',
    });
    expect(err.isAlreadyConverted()).toBe(false);
  });

  it('isAlreadyConverted returns false when details are not the right shape', () => {
    const err = new LeadServiceError('ALREADY_CONVERTED', 'msg', { foo: 'bar' });
    expect(err.isAlreadyConverted()).toBe(false);
  });
});

// ─── fromPostgrestError ───────────────────────────────────────────────────

describe('fromPostgrestError', () => {
  it('maps HTTP 401 to SESSION_EXPIRED', () => {
    const err = fromPostgrestError({ status: 401, message: 'jwt expired' });
    expect(err.code).toBe('SESSION_EXPIRED');
  });

  it('maps statusCode 401 to SESSION_EXPIRED', () => {
    const err = fromPostgrestError({ statusCode: 401, message: 'unauthorized' });
    expect(err.code).toBe('SESSION_EXPIRED');
  });

  it('maps SQLSTATE 42501 to NOT_AUTHORIZED', () => {
    const err = fromPostgrestError({ code: '42501', message: 'permission denied' });
    expect(err.code).toBe('NOT_AUTHORIZED');
  });

  it('parses known error code from message prefix', () => {
    const err = fromPostgrestError({ message: 'NOT_AUTHORIZED', code: 'P0001' });
    expect(err.code).toBe('NOT_AUTHORIZED');
  });

  it('parses ALREADY_CONVERTED with structured JSON details', () => {
    const err = fromPostgrestError({
      message: 'ALREADY_CONVERTED',
      code: 'P0001',
      details: JSON.stringify({
        existing_booking_id: 'bk-1',
        existing_booking_code: 'W-260525-abc',
      }),
      hint: 'Navigate to existing booking',
    });
    expect(err.code).toBe('ALREADY_CONVERTED');
    expect(err.isAlreadyConverted()).toBe(true);
    if (err.isAlreadyConverted()) {
      expect(err.details.existing_booking_id).toBe('bk-1');
      expect(err.details.existing_booking_code).toBe('W-260525-abc');
    }
    expect(err.hint).toBe('Navigate to existing booking');
  });

  it('preserves details as string when not JSON', () => {
    const err = fromPostgrestError({
      message: 'WALKIN_ARGS_INCOMPLETE',
      details: 'Required keys: guest_details, ...',
    });
    expect(err.code).toBe('WALKIN_ARGS_INCOMPLETE');
    expect(err.details).toBe('Required keys: guest_details, ...');
  });

  it('parses INVALID_TRANSITION extracting from/to', () => {
    const err = fromPostgrestError({ message: 'INVALID_TRANSITION: NEW -> CONVERTED' });
    expect(err.code).toBe('INVALID_TRANSITION');
    expect(err.details).toEqual({ from: 'NEW', to: 'CONVERTED' });
  });

  it('falls back to UNKNOWN_ERROR on unrecognized message', () => {
    const err = fromPostgrestError({ message: 'some random error' });
    expect(err.code).toBe('UNKNOWN_ERROR');
    expect(err.message).toBe('some random error');
  });

  it('handles null/undefined input', () => {
    expect(fromPostgrestError(null).code).toBe('UNKNOWN_ERROR');
    expect(fromPostgrestError(undefined).code).toBe('UNKNOWN_ERROR');
  });

  it('preserves the original error in cause for Sentry', () => {
    const orig = { message: 'NOT_AUTHORIZED', code: 'P0001' };
    const err = fromPostgrestError(orig);
    expect(err.cause).toBe(orig);
  });
});

// ─── Service: lifecycle RPCs ──────────────────────────────────────────────

describe('createLead', () => {
  it('calls create_lead with mapped args', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { lead_id: 'L1', duplicate_warning: null },
      error: null,
    });
    const out = await createLead({
      hotelId: 'H1',
      source: 'WALK_IN',
      contactName: 'Test',
      contactPhone: '+919999900000',
    });
    expect(rpcMock).toHaveBeenCalledWith('create_lead', {
      p_hotel_id: 'H1',
      p_source: 'WALK_IN',
      p_contact_name: 'Test',
      p_source_detail: null,
      p_contact_phone: '+919999900000',
      p_contact_email: null,
      p_check_in: null,
      p_check_out: null,
      p_party_adults: 1,
      p_party_children: 0,
      p_room_count: 1,
      p_value_estimate: null,
      p_notes: null,
      p_tags: [],
    });
    expect(out.lead_id).toBe('L1');
    expect(out.duplicate_warning).toBeNull();
  });

  it('throws LeadServiceError on Postgrest error', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'NOT_AUTHORIZED', code: 'P0001' },
    });
    await expect(
      createLead({ hotelId: 'H1', source: 'WALK_IN', contactName: 'X', contactPhone: '+91' }),
    ).rejects.toBeInstanceOf(LeadServiceError);
  });
});

describe('transitionLeadStatus', () => {
  it('passes reason and converted_booking_id', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await transitionLeadStatus('L1', 'CONVERTED', {
      reason: 'verbal commit',
      convertedBookingId: 'B1',
    });
    expect(rpcMock).toHaveBeenCalledWith('transition_lead_status', {
      p_lead_id: 'L1',
      p_to_status: 'CONVERTED',
      p_reason: 'verbal commit',
      p_converted_booking_id: 'B1',
    });
  });

  it('defaults reason and booking to null', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await transitionLeadStatus('L1', 'QUALIFIED');
    expect(rpcMock).toHaveBeenCalledWith('transition_lead_status', {
      p_lead_id: 'L1',
      p_to_status: 'QUALIFIED',
      p_reason: null,
      p_converted_booking_id: null,
    });
  });
});

describe('assignLead', () => {
  it('assigns to a user', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await assignLead('L1', 'U1');
    expect(rpcMock).toHaveBeenCalledWith('assign_lead', {
      p_lead_id: 'L1',
      p_user_id: 'U1',
    });
  });

  it('unassigns via null', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await assignLead('L1', null);
    expect(rpcMock).toHaveBeenCalledWith('assign_lead', {
      p_lead_id: 'L1',
      p_user_id: null,
    });
  });
});

describe('softDeleteLead', () => {
  it('passes reason', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await softDeleteLead('L1', 'duplicate booking');
    expect(rpcMock).toHaveBeenCalledWith('soft_delete_lead', {
      p_lead_id: 'L1',
      p_reason: 'duplicate booking',
    });
  });
});

describe('updateLeadContact', () => {
  it('sends only provided fields, rest null', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await updateLeadContact('L1', { email: 'new@example.com' });
    expect(rpcMock).toHaveBeenCalledWith('update_lead_contact', {
      p_lead_id: 'L1',
      p_name: null,
      p_phone: null,
      p_email: 'new@example.com',
    });
  });
});

describe('updateLeadBasics', () => {
  it('maps camelCase to snake_case args, leaves untouched null', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await updateLeadBasics('L1', {
      checkIn: '2026-07-10',
      partyAdults: 4,
      valueEstimate: 25000,
    });
    expect(rpcMock).toHaveBeenCalledWith('update_lead_basics', {
      p_lead_id: 'L1',
      p_check_in: '2026-07-10',
      p_check_out: null,
      p_party_adults: 4,
      p_party_children: null,
      p_room_count: null,
      p_value_estimate: 25000,
      p_source_detail: null,
      p_tags: null,
    });
  });
});

describe('addLeadNote', () => {
  it('returns event_id from RPC', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'EVT-1', error: null });
    const out = await addLeadNote('L1', 'Called guest');
    expect(out).toBe('EVT-1');
    expect(rpcMock).toHaveBeenCalledWith('add_lead_note', {
      p_lead_id: 'L1',
      p_text: 'Called guest',
    });
  });
});

// ─── Service: claim lock ──────────────────────────────────────────────────

describe('claimLead', () => {
  it('returns ClaimStatus from RPC', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        ok: true,
        claimed_by: 'U1',
        claimed_by_name: 'priya',
        claimed_at: '2026-05-25T14:00:00Z',
        claim_expires_at: '2026-05-25T14:15:00Z',
        is_expired: false,
        is_self: true,
      },
      error: null,
    });
    const out = await claimLead('L1');
    expect(out.ok).toBe(true);
    expect(out.claimed_by_name).toBe('priya');
  });
});

describe('releaseClaim', () => {
  it('returns released boolean', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        ok: true,
        released: true,
        claimed_by: null,
        claimed_by_name: null,
        claimed_at: null,
        claim_expires_at: null,
        is_expired: true,
        is_self: false,
      },
      error: null,
    });
    const out = await releaseClaim('L1');
    expect(out.released).toBe(true);
  });
});

describe('forceReleaseClaim', () => {
  it('passes reason and returns release_type', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        ok: true,
        released: true,
        release_type: 'forced',
        claimed_by: null,
        claimed_by_name: null,
        claimed_at: null,
        claim_expires_at: null,
        is_expired: true,
        is_self: false,
      },
      error: null,
    });
    const out = await forceReleaseClaim('L1', 'end of shift');
    expect(out.release_type).toBe('forced');
    expect(rpcMock).toHaveBeenCalledWith('force_release_claim', {
      p_lead_id: 'L1',
      p_reason: 'end of shift',
    });
  });
});

describe('getLeadClaimStatus', () => {
  it('reads claim state', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        ok: true,
        claimed_by: null,
        claimed_by_name: null,
        claimed_at: null,
        claim_expires_at: null,
        is_expired: true,
        is_self: false,
      },
      error: null,
    });
    const out = await getLeadClaimStatus('L1');
    expect(out.ok).toBe(true);
  });
});

// ─── Service: conversion ──────────────────────────────────────────────────

describe('convertLeadToWalkin', () => {
  it('passes walkin_args jsonb through', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        ok: true,
        booking_id: 'B1',
        booking_code: 'W-abc',
        from_status: 'WON',
        promoted_through: [],
        conversion_latency_ms: 11,
      },
      error: null,
    });
    const args = {
      guest_details: { full_name: 'Test' },
      room_selections: [{ room_id: 'R1', room_type_id: 'RT1', amount_per_night: 2500 }],
      checkin_date: '2026-05-25',
      checkout_date: '2026-05-26',
    };
    const out = await convertLeadToWalkin('L1', args);
    expect(out.booking_id).toBe('B1');
    expect(rpcMock).toHaveBeenCalledWith('convert_lead_to_walkin', {
      p_lead_id: 'L1',
      p_walkin_args: args,
    });
  });

  it('wraps ALREADY_CONVERTED with structured details', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'ALREADY_CONVERTED',
        details: JSON.stringify({
          existing_booking_id: 'B-existing',
          existing_booking_code: 'W-existing',
        }),
      },
    });
    try {
      await convertLeadToWalkin('L1', {
        guest_details: { full_name: 'X' },
        room_selections: [],
        checkin_date: '2026-05-25',
        checkout_date: '2026-05-26',
      });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(LeadServiceError);
      const err = e as LeadServiceError;
      expect(err.code).toBe('ALREADY_CONVERTED');
      expect(err.isAlreadyConverted()).toBe(true);
    }
  });
});

// ─── Service: reads ───────────────────────────────────────────────────────

describe('listLeads', () => {
  it('applies hotel_id + default deleted_at IS NULL', async () => {
    const query = buildQueryMock({ data: [], error: null });
    fromBuilderMock.mockReturnValueOnce(query);
    await listLeads('H1');
    expect(fromBuilderMock).toHaveBeenCalledWith('leads');
    expect(query.eq).toHaveBeenCalledWith('hotel_id', 'H1');
    expect(query.is).toHaveBeenCalledWith('deleted_at', null);
    expect(query.order).toHaveBeenCalledWith('last_activity_at', { ascending: false });
  });

  it('handles status + source filters as IN clauses', async () => {
    const query = buildQueryMock({ data: [], error: null });
    fromBuilderMock.mockReturnValueOnce(query);
    await listLeads('H1', {
      status: ['NEW', 'QUALIFIED'],
      source: ['WALK_IN'],
    });
    expect(query.in).toHaveBeenCalledWith('status', ['NEW', 'QUALIFIED']);
    expect(query.in).toHaveBeenCalledWith('source', ['WALK_IN']);
  });

  it('assignedTo=null filters unassigned', async () => {
    const query = buildQueryMock({ data: [], error: null });
    fromBuilderMock.mockReturnValueOnce(query);
    await listLeads('H1', { assignedTo: null });
    expect(query.is).toHaveBeenCalledWith('assigned_to', null);
  });

  it('assignedTo as uuid filters by user', async () => {
    const query = buildQueryMock({ data: [], error: null });
    fromBuilderMock.mockReturnValueOnce(query);
    await listLeads('H1', { assignedTo: 'U1' });
    expect(query.eq).toHaveBeenCalledWith('assigned_to', 'U1');
  });

  it('search builds OR across name/phone/phone_normalized/email', async () => {
    const query = buildQueryMock({ data: [], error: null });
    fromBuilderMock.mockReturnValueOnce(query);
    await listLeads('H1', { search: 'priya' });
    expect(query.or).toHaveBeenCalledWith(
      'contact_name.ilike.%priya%,contact_phone.ilike.%priya%,contact_phone_normalized.ilike.%priya%,contact_email.ilike.%priya%',
    );
  });

  it('search by phone digits matches normalized column (the Day 7 fix)', async () => {
    const query = buildQueryMock({ data: [], error: null });
    fromBuilderMock.mockReturnValueOnce(query);
    await listLeads('H1', { search: '9876543210' });
    // The OR string must include the contact_phone_normalized column so
    // "9876543210" matches stored "+919876543210"
    const orArg = query.or.mock.calls[0][0] as string;
    expect(orArg).toContain('contact_phone_normalized.ilike');
  });

  it('always chains the stable id tie-breaker for pagination', async () => {
    const query = buildQueryMock({ data: [], error: null });
    fromBuilderMock.mockReturnValueOnce(query);
    await listLeads('H1');
    // First .order is the primary sort; second is the tie-breaker
    expect(query.order).toHaveBeenNthCalledWith(2, 'id', { ascending: false });
  });

  it('uses nullsFirst:false when nullsLast=true (value sort)', async () => {
    const query = buildQueryMock({ data: [], error: null });
    fromBuilderMock.mockReturnValueOnce(query);
    await listLeads('H1', { orderBy: 'value_estimate', orderDir: 'desc', nullsLast: true });
    expect(query.order).toHaveBeenNthCalledWith(1, 'value_estimate', {
      ascending: false,
      nullsFirst: false,
    });
  });

  it('returns { leads, total } shape with total=null when no count requested', async () => {
    const query = buildQueryMock({ data: [{ id: 'L1' }], error: null });
    fromBuilderMock.mockReturnValueOnce(query);
    const out = await listLeads('H1');
    expect(out.leads).toEqual([{ id: 'L1' }]);
    expect(out.total).toBeNull();
  });

  it('returns total when includeCount=true', async () => {
    const query = buildQueryMock({ data: [{ id: 'L1' }], error: null, count: 142 });
    fromBuilderMock.mockReturnValueOnce(query);
    const out = await listLeads('H1', { includeCount: true });
    expect(out.total).toBe(142);
  });

  it('throws LeadServiceError on Postgrest error', async () => {
    const query = buildQueryMock({
      data: null,
      error: { message: 'NOT_AUTHORIZED', code: 'P0001' },
    });
    fromBuilderMock.mockReturnValueOnce(query);
    await expect(listLeads('H1')).rejects.toBeInstanceOf(LeadServiceError);
  });
});

describe('getLead', () => {
  it('returns lead or null', async () => {
    const query = buildQueryMock({ data: { id: 'L1' }, error: null });
    fromBuilderMock.mockReturnValueOnce(query);
    const out = await getLead('L1');
    expect(query.eq).toHaveBeenCalledWith('id', 'L1');
    expect(query.maybeSingle).toHaveBeenCalled();
    expect(out).toEqual({ id: 'L1' });
  });
});

describe('getLeadEvents', () => {
  it('respects limit and orders DESC', async () => {
    const query = buildQueryMock({ data: [], error: null });
    fromBuilderMock.mockReturnValueOnce(query);
    await getLeadEvents('L1', { limit: 20 });
    expect(query.order).toHaveBeenCalledWith('occurred_at', { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(20);
  });

  it('drops malformed events with Sentry warning', async () => {
    const validRow = {
      id: 'E1',
      lead_id: 'L1',
      hotel_id: 'H1',
      event_type: 'NOTE_ADDED',
      event_schema_version: 1,
      payload: { text: 'hello' },
      actor_id: 'U1',
      occurred_at: '2026-05-25T14:00:00Z',
    };
    const malformedRow = { ...validRow, id: 'E2', payload: { wrong_field: true } };
    const query = buildQueryMock({ data: [validRow, malformedRow], error: null });
    fromBuilderMock.mockReturnValueOnce(query);
    const out = await getLeadEvents('L1');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('E1');
    expect(captureMessageMock).toHaveBeenCalledWith(
      'leadService.malformed_event_payload',
      'warning',
      expect.objectContaining({ eventType: 'NOTE_ADDED', eventId: 'E2' }),
    );
  });
});

// ─── validateLeadEventRow ─────────────────────────────────────────────────

describe('validateLeadEventRow', () => {
  const baseEvent = (event_type: string, payload: unknown, extra: Record<string, unknown> = {}) => ({
    id: 'E1',
    lead_id: 'L1',
    hotel_id: 'H1',
    event_type,
    event_schema_version: 1,
    payload,
    actor_id: 'U1',
    occurred_at: '2026-05-25T14:00:00Z',
    ...extra,
  });

  it('returns null for non-object input', () => {
    expect(validateLeadEventRow(null)).toBeNull();
    expect(validateLeadEventRow('hello')).toBeNull();
    expect(validateLeadEventRow([1, 2, 3])).toBeNull();
  });

  it('returns null when required top-level fields missing', () => {
    expect(validateLeadEventRow({ id: 'E1' })).toBeNull();
  });

  it('returns null + logs warning for unknown event_type', () => {
    const raw = baseEvent('FUTURE_EVENT_TYPE', { foo: 1 });
    expect(validateLeadEventRow(raw)).toBeNull();
    expect(captureMessageMock).toHaveBeenCalledWith(
      'leadService.unknown_event_type',
      'warning',
      expect.objectContaining({ eventType: 'FUTURE_EVENT_TYPE' }),
    );
  });

  it('returns null + logs warning for unknown schema_version', () => {
    const raw = baseEvent('NOTE_ADDED', { text: 'hi' }, {
      event_schema_version: KNOWN_MAX_SCHEMA_VERSION + 99,
    });
    expect(validateLeadEventRow(raw)).toBeNull();
    expect(captureMessageMock).toHaveBeenCalledWith(
      'leadService.unknown_schema_version',
      'warning',
      expect.any(Object),
    );
  });

  it('defaults schema_version to 1 when missing', () => {
    const raw = baseEvent('NOTE_ADDED', { text: 'hi' });
    delete (raw as Record<string, unknown>).event_schema_version;
    const ev = validateLeadEventRow(raw);
    expect(ev).not.toBeNull();
    expect(ev!.event_schema_version).toBe(1);
  });

  describe('per-type validators', () => {
    it('CREATED accepts well-formed payload', () => {
      const raw = baseEvent('CREATED', {
        source: 'WALK_IN',
        source_detail: null,
        actor_role: 'OWNER',
        has_phone: true,
        has_email: false,
      });
      const ev = validateLeadEventRow(raw);
      expect(ev?.event_type).toBe('CREATED');
      if (ev?.event_type === 'CREATED') {
        expect(ev.payload.source).toBe('WALK_IN');
      }
    });

    it('STATUS_CHANGED accepts auto-promoted with all optional fields', () => {
      const raw = baseEvent('STATUS_CHANGED', {
        from: 'NEW',
        to: 'QUALIFIED',
        reason: 'convert_to_walkin',
        converted_booking_id: null,
        actor_role: 'OWNER',
        auto_promoted: true,
        transition_mode: 'auto_convert',
        conversion_started_from: 'NEW',
      });
      const ev = validateLeadEventRow(raw) as LeadEvent_STATUS_CHANGED | null;
      expect(ev?.event_type).toBe('STATUS_CHANGED');
      if (ev?.event_type === 'STATUS_CHANGED') {
        expect(ev.payload.auto_promoted).toBe(true);
        expect(ev.payload.transition_mode).toBe('auto_convert');
      }
    });

    it('STATUS_CHANGED accepts unknown transition_mode string (open union)', () => {
      const raw = baseEvent('STATUS_CHANGED', {
        from: 'NEW',
        to: 'QUALIFIED',
        reason: null,
        converted_booking_id: null,
        actor_role: 'OWNER',
        transition_mode: 'bulk_import_future_mode',
      });
      const ev = validateLeadEventRow(raw);
      expect(ev).not.toBeNull();
      if (ev?.event_type === 'STATUS_CHANGED') {
        expect(ev.payload.transition_mode).toBe('bulk_import_future_mode');
      }
    });

    it('ASSIGNED requires to_user and by_user', () => {
      const valid = validateLeadEventRow(
        baseEvent('ASSIGNED', { to_user: 'U1', by_user: 'U2', prev_user: null }),
      );
      expect(valid).not.toBeNull();

      const missing = validateLeadEventRow(baseEvent('ASSIGNED', { to_user: 'U1' }));
      expect(missing).toBeNull();
    });

    it('UNASSIGNED requires from_user and by_user', () => {
      expect(
        validateLeadEventRow(baseEvent('UNASSIGNED', { from_user: 'U1', by_user: 'U2' })),
      ).not.toBeNull();
      expect(validateLeadEventRow(baseEvent('UNASSIGNED', {}))).toBeNull();
    });

    it('CLAIMED accepts well-formed payload with snapshot name', () => {
      const ev = validateLeadEventRow(
        baseEvent('CLAIMED', {
          by_user: 'U1',
          by_user_name: 'priya',
          prev_user: null,
          prev_user_name: null,
          expires_at: '2026-05-25T14:15:00Z',
          took_over_expired: false,
        }),
      );
      expect(ev?.event_type).toBe('CLAIMED');
    });

    it('CLAIM_RELEASED accepts all 3 release_type values', () => {
      for (const release_type of ['manual', 'forced', 'auto_on_convert'] as const) {
        const ev = validateLeadEventRow(
          baseEvent('CLAIM_RELEASED', {
            by_user: 'U1',
            by_user_name: 'priya',
            prev_holder: 'U1',
            prev_holder_name: 'priya',
            release_type,
            reason: null,
            actor_role: null,
          }),
        );
        expect(ev?.event_type).toBe('CLAIM_RELEASED');
        if (ev?.event_type === 'CLAIM_RELEASED') {
          expect(ev.payload.release_type).toBe(release_type);
        }
      }
    });

    it('NOTE_ADDED accepts text', () => {
      const ev = validateLeadEventRow(baseEvent('NOTE_ADDED', { text: 'Called guest' }));
      expect(ev?.event_type).toBe('NOTE_ADDED');
      if (ev?.event_type === 'NOTE_ADDED') {
        expect(ev.payload.text).toBe('Called guest');
      }
    });

    it('CONTACT_UPDATED accepts changes map', () => {
      const ev = validateLeadEventRow(
        baseEvent('CONTACT_UPDATED', {
          changes: { email: [null, 'new@example.com'] },
        }),
      );
      expect(ev?.event_type).toBe('CONTACT_UPDATED');
    });

    it('BASICS_UPDATED accepts changes map', () => {
      const ev = validateLeadEventRow(
        baseEvent('BASICS_UPDATED', { changes: { party_adults: [1, 4] } }),
      );
      expect(ev?.event_type).toBe('BASICS_UPDATED');
    });

    it('QUOTE_SENT validates channel literal', () => {
      const ok = validateLeadEventRow(
        baseEvent('QUOTE_SENT', { quote_id: 'Q1', channel: 'EMAIL' }),
      );
      expect(ok?.event_type).toBe('QUOTE_SENT');
      const bad = validateLeadEventRow(
        baseEvent('QUOTE_SENT', { quote_id: 'Q1', channel: 'CARRIER_PIGEON' }),
      );
      expect(bad).toBeNull();
    });

    it('CONVERTED_TO_BOOKING accepts payload with latency_ms', () => {
      const ev = validateLeadEventRow(
        baseEvent('CONVERTED_TO_BOOKING', {
          booking_id: 'B1',
          booking_code: 'W-abc',
          from_status: 'WON',
          promoted_through: [],
          by_user: 'U1',
          by_user_name: 'priya',
          actor_role: 'OWNER',
          conversion_origin: 'walkin',
          conversion_latency_ms: 234,
        }),
      );
      expect(ev?.event_type).toBe('CONVERTED_TO_BOOKING');
      if (ev?.event_type === 'CONVERTED_TO_BOOKING') {
        expect(ev.payload.conversion_latency_ms).toBe(234);
      }
    });

    it('CONVERTED_TO_BOOKING accepts payload WITHOUT latency_ms (optional)', () => {
      const ev = validateLeadEventRow(
        baseEvent('CONVERTED_TO_BOOKING', {
          booking_id: 'B1',
          booking_code: 'W-abc',
          from_status: 'WON',
          promoted_through: [],
          by_user: 'U1',
          by_user_name: 'priya',
          actor_role: 'OWNER',
          conversion_origin: 'walkin',
        }),
      );
      expect(ev).not.toBeNull();
      if (ev?.event_type === 'CONVERTED_TO_BOOKING') {
        expect(ev.payload.conversion_latency_ms).toBeUndefined();
      }
    });

    it('SOFT_DELETED accepts payload', () => {
      const ev = validateLeadEventRow(
        baseEvent('SOFT_DELETED', { reason: 'dup', actor_role: 'OWNER' }),
      );
      expect(ev?.event_type).toBe('SOFT_DELETED');
    });

    it('REOPENED accepts payload', () => {
      const ev = validateLeadEventRow(baseEvent('REOPENED', { previous_reason: 'budget' }));
      expect(ev?.event_type).toBe('REOPENED');
    });

    it('TAG_ADDED requires tag string', () => {
      expect(validateLeadEventRow(baseEvent('TAG_ADDED', { tag: 'honeymoon' }))).not.toBeNull();
      expect(validateLeadEventRow(baseEvent('TAG_ADDED', {}))).toBeNull();
    });
  });
});

// Type helper for STATUS_CHANGED narrowing in a test above
type LeadEvent_STATUS_CHANGED = {
  event_type: 'STATUS_CHANGED';
  payload: LeadEventPayloads['STATUS_CHANGED'];
} & Record<string, unknown>;

// ─── Telemetry breadcrumbs (Day 7) ────────────────────────────────────────

describe('telemetry breadcrumbs', () => {
  it('fires success breadcrumb with duration_ms on RPC success', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'EVT-1', error: null });
    await addLeadNote('L1', 'note');
    const okCalls = addBreadcrumbMock.mock.calls.filter(
      (c) => (c[0] as { message: string }).message === 'add_lead_note ok',
    );
    expect(okCalls.length).toBe(1);
    const crumb = okCalls[0][0] as { data: { rpc: string; duration_ms: number } };
    expect(crumb.data.rpc).toBe('add_lead_note');
    expect(typeof crumb.data.duration_ms).toBe('number');
    expect(crumb.data.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('fires error breadcrumb with duration_ms on RPC failure', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'NOT_AUTHORIZED', code: 'P0001' },
    });
    try {
      await addLeadNote('L1', 'note');
    } catch {
      // expected
    }
    const errorCalls = addBreadcrumbMock.mock.calls.filter(
      (c) => (c[0] as { level: string }).level === 'error',
    );
    expect(errorCalls.length).toBeGreaterThan(0);
    const crumb = errorCalls[0][0] as { data: { duration_ms: number; code: string } };
    expect(typeof crumb.data.duration_ms).toBe('number');
    expect(crumb.data.code).toBe('NOT_AUTHORIZED');
  });

  it('fires breadcrumb on listLeads success with row count', async () => {
    const query = buildQueryMock({ data: [{ id: 'L1' }, { id: 'L2' }], error: null });
    fromBuilderMock.mockReturnValueOnce(query);
    await listLeads('H1');
    const crumb = addBreadcrumbMock.mock.calls.find(
      (c) => (c[0] as { message: string }).message === 'listLeads ok',
    );
    expect(crumb).toBeDefined();
    const data = (crumb![0] as { data: { rows: number } }).data;
    expect(data.rows).toBe(2);
  });
});
