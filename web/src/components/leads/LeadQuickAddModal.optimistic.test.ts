import { describe, expect, it } from 'vitest';
import { buildOptimisticLead, isOptimisticLead } from './LeadQuickAddModal.optimistic';
import type { CreateLeadInput, Lead } from '../../types/lead';

const fixedNow = () => '2026-05-25T14:00:00.000Z';
const fixedUuid = () => '11111111-2222-3333-4444-555555555555';

const baseInput: CreateLeadInput = {
  hotelId: 'H1',
  source: 'WALK_IN',
  contactName: 'Priya Sharma',
  contactPhone: '+919876543210',
};

describe('buildOptimisticLead', () => {
  it('returns a row tagged __optimistic with deterministic ids when deps injected', () => {
    const out = buildOptimisticLead(baseInput, 'H1', 'U1', { now: fixedNow, uuid: fixedUuid });
    expect(out.__optimistic).toBe(true);
    expect(out.__client_request_id).toBe('11111111-2222-3333-4444-555555555555');
    expect(out.id).toBe(`optimistic-${fixedUuid()}`);
    expect(out.hotel_id).toBe('H1');
    expect(out.created_by).toBe('U1');
    expect(out.created_at).toBe(fixedNow());
    expect(out.status).toBe('NEW');
  });

  it('defaults party to 1 adult, 0 children, 1 room', () => {
    const out = buildOptimisticLead(baseInput, 'H1', null, { now: fixedNow, uuid: fixedUuid });
    expect(out.party_adults).toBe(1);
    expect(out.party_children).toBe(0);
    expect(out.room_count).toBe(1);
  });

  it('passes through party + value when provided', () => {
    const out = buildOptimisticLead(
      { ...baseInput, partyAdults: 4, partyChildren: 2, roomCount: 2, valueEstimate: 25000 },
      'H1',
      'U1',
      { now: fixedNow, uuid: fixedUuid },
    );
    expect(out.party_adults).toBe(4);
    expect(out.party_children).toBe(2);
    expect(out.room_count).toBe(2);
    expect(out.value_estimate).toBe(25000);
  });

  it('truncates note preview to 200 chars', () => {
    const longNote = 'x'.repeat(500);
    const out = buildOptimisticLead({ ...baseInput, notes: longNote }, 'H1', null, {
      now: fixedNow,
      uuid: fixedUuid,
    });
    expect(out.latest_note_preview).toHaveLength(200);
  });

  it('synthetic id always prefixed with optimistic- (cannot collide with real uuids)', () => {
    const out = buildOptimisticLead(baseInput, 'H1', null);
    expect(out.id.startsWith('optimistic-')).toBe(true);
  });

  it('preserves all required Lead fields (shape-completeness sanity)', () => {
    const out = buildOptimisticLead(baseInput, 'H1', 'U1', { now: fixedNow, uuid: fixedUuid });
    const requiredFields: (keyof Lead)[] = [
      'id', 'hotel_id', 'source', 'contact_name',
      'party_adults', 'party_children', 'room_count',
      'status', 'tags', 'created_at', 'updated_at', 'last_activity_at',
    ];
    for (const f of requiredFields) {
      expect(out[f]).toBeDefined();
    }
  });
});

describe('isOptimisticLead', () => {
  it('returns true for optimistic rows', () => {
    const o = buildOptimisticLead(baseInput, 'H1', null);
    expect(isOptimisticLead(o)).toBe(true);
  });

  it('returns false for a regular Lead (no __optimistic flag)', () => {
    const regular: Lead = {
      id: 'real-uuid',
      hotel_id: 'H1',
      source: 'WALK_IN',
      source_detail: null,
      partner_id: null,
      contact_name: 'X',
      contact_phone: null,
      contact_phone_normalized: null,
      contact_email: 'x@example.com',
      requested_check_in: null,
      requested_check_out: null,
      party_adults: 1,
      party_children: 0,
      room_count: 1,
      value_estimate: null,
      status: 'NEW',
      status_reason: null,
      assigned_to: null,
      claimed_by: null,
      claimed_at: null,
      converted_booking_id: null,
      won_at: null,
      converted_at: null,
      latest_note_preview: null,
      tags: [],
      created_at: '2026-05-25T14:00:00Z',
      created_by: null,
      updated_at: '2026-05-25T14:00:00Z',
      last_activity_at: '2026-05-25T14:00:00Z',
      deleted_at: null,
    };
    expect(isOptimisticLead(regular)).toBe(false);
  });
});
