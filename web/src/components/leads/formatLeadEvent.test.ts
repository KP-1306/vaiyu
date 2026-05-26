import { describe, expect, it } from 'vitest';
import { formatLeadEvent } from './formatLeadEvent';
import type { LeadEvent, LeadEventPayloads } from '../../types/lead';

function makeEvent<K extends keyof LeadEventPayloads>(
  type: K,
  payload: LeadEventPayloads[K],
): LeadEvent {
  return {
    id: 'E1',
    lead_id: 'L1',
    hotel_id: 'H1',
    event_type: type,
    event_schema_version: 1,
    payload: payload as LeadEventPayloads[K],
    actor_id: 'U1',
    occurred_at: '2026-05-25T14:00:00Z',
  } as unknown as LeadEvent;
}

describe('formatLeadEvent', () => {
  it('CREATED returns source name + actor', () => {
    const out = formatLeadEvent(
      makeEvent('CREATED', {
        source: 'WALK_IN',
        source_detail: null,
        actor_role: 'OWNER',
        has_phone: true,
        has_email: false,
        by_user_name: 'priya',
      }),
    );
    expect(out.iconName).toBe('plus');
    expect(out.title).toContain('Walk-in');
    expect(out.actor).toBe('priya');
  });

  it('CREATED falls back to "unknown" actor when by_user_name absent', () => {
    const out = formatLeadEvent(
      makeEvent('CREATED', {
        source: 'WEBSITE',
        source_detail: null,
        actor_role: 'OWNER',
        has_phone: false,
        has_email: true,
      }),
    );
    expect(out.actor).toBe('unknown');
  });

  it('STATUS_CHANGED to WON is emerald', () => {
    const out = formatLeadEvent(
      makeEvent('STATUS_CHANGED', {
        from: 'QUOTED',
        to: 'WON',
        reason: 'verbal commit',
        converted_booking_id: null,
        actor_role: 'OWNER',
        by_user_name: 'priya',
      }),
    );
    expect(out.color).toBe('emerald');
    expect(out.title).toContain('Won');
    expect(out.detail).toBe('verbal commit');
  });

  it('STATUS_CHANGED to LOST is red', () => {
    const out = formatLeadEvent(
      makeEvent('STATUS_CHANGED', {
        from: 'QUOTED',
        to: 'LOST',
        reason: 'budget',
        converted_booking_id: null,
        actor_role: 'OWNER',
      }),
    );
    expect(out.color).toBe('red');
  });

  it('STATUS_CHANGED auto-promoted shows mode in detail', () => {
    const out = formatLeadEvent(
      makeEvent('STATUS_CHANGED', {
        from: 'NEW',
        to: 'QUALIFIED',
        reason: null,
        converted_booking_id: null,
        actor_role: 'OWNER',
        auto_promoted: true,
        transition_mode: 'auto_convert',
      }),
    );
    expect(out.detail).toContain('auto_convert');
  });

  it('ASSIGNED uses to_user_name', () => {
    const out = formatLeadEvent(
      makeEvent('ASSIGNED', {
        to_user: 'U2',
        to_user_name: 'raj',
        prev_user: null,
        by_user: 'U1',
        by_user_name: 'priya',
      }),
    );
    expect(out.title).toContain('raj');
    expect(out.actor).toBe('priya');
  });

  it('UNASSIGNED includes from_user_name when present', () => {
    const out = formatLeadEvent(
      makeEvent('UNASSIGNED', {
        from_user: 'U2',
        from_user_name: 'raj',
        by_user: 'U1',
        by_user_name: 'priya',
      }),
    );
    expect(out.title).toContain('raj');
  });

  it('CLAIMED marks took_over_expired in detail', () => {
    const out = formatLeadEvent(
      makeEvent('CLAIMED', {
        by_user: 'U1',
        by_user_name: 'priya',
        prev_user: 'U2',
        prev_user_name: 'raj',
        expires_at: '2026-05-25T15:00:00Z',
        took_over_expired: true,
      }),
    );
    expect(out.detail).toContain('expired');
  });

  it('CLAIM_RELEASED forced is red + includes prev_holder + reason', () => {
    const out = formatLeadEvent(
      makeEvent('CLAIM_RELEASED', {
        by_user: 'U1',
        by_user_name: 'owner',
        prev_holder: 'U2',
        prev_holder_name: 'raj',
        release_type: 'forced',
        reason: 'end of shift',
        actor_role: 'OWNER',
      }),
    );
    expect(out.color).toBe('red');
    expect(out.title).toContain('Force-released');
    expect(out.title).toContain('raj');
    expect(out.detail).toContain('end of shift');
  });

  it('CLAIM_RELEASED manual is slate, no detail', () => {
    const out = formatLeadEvent(
      makeEvent('CLAIM_RELEASED', {
        by_user: 'U1',
        by_user_name: 'priya',
        prev_holder: 'U1',
        prev_holder_name: 'priya',
        release_type: 'manual',
        reason: null,
        actor_role: null,
      }),
    );
    expect(out.color).toBe('slate');
    expect(out.detail).toBeNull();
  });

  it('NOTE_ADDED uses text as title + by_user_name as actor', () => {
    const out = formatLeadEvent(
      makeEvent('NOTE_ADDED', { text: 'Called guest at 4pm', by_user_name: 'priya' }),
    );
    expect(out.title).toBe('Called guest at 4pm');
    expect(out.actor).toBe('priya');
  });

  it('CONTACT_UPDATED formats changes as old → new pairs', () => {
    const out = formatLeadEvent(
      makeEvent('CONTACT_UPDATED', {
        changes: { email: [null, 'new@example.com'], name: ['Old', 'New'] },
        by_user_name: 'priya',
      }),
    );
    expect(out.detail).toContain('email: — → new@example.com');
    expect(out.detail).toContain('name: Old → New');
  });

  it('BASICS_UPDATED formats changes', () => {
    const out = formatLeadEvent(
      makeEvent('BASICS_UPDATED', {
        changes: { party_adults: [1, 4] },
        by_user_name: 'priya',
      }),
    );
    expect(out.title).toContain('Stay details');
    expect(out.detail).toContain('party_adults');
  });

  it('CONVERTED_TO_BOOKING shows booking code and promoted count', () => {
    const out = formatLeadEvent(
      makeEvent('CONVERTED_TO_BOOKING', {
        booking_id: 'B1',
        booking_code: 'W-abc',
        from_status: 'NEW',
        promoted_through: ['QUALIFIED', 'QUOTED', 'WON'],
        by_user: 'U1',
        by_user_name: 'priya',
        actor_role: 'OWNER',
        conversion_origin: 'walkin',
        conversion_latency_ms: 234,
      }),
    );
    expect(out.title).toContain('W-abc');
    expect(out.detail).toContain('3 stages');
    expect(out.detail).toContain('234ms');
  });

  it('SOFT_DELETED uses reason as detail', () => {
    const out = formatLeadEvent(
      makeEvent('SOFT_DELETED', {
        reason: 'duplicate',
        actor_role: 'OWNER',
        by_user_name: 'owner',
      }),
    );
    expect(out.iconName).toBe('trash-2');
    expect(out.detail).toBe('duplicate');
  });

  it('REOPENED includes previous_reason when present', () => {
    const out = formatLeadEvent(
      makeEvent('REOPENED', { previous_reason: 'budget', by_user_name: 'priya' }),
    );
    expect(out.detail).toContain('budget');
  });

  it('TAG_ADDED + TAG_REMOVED format', () => {
    expect(formatLeadEvent(makeEvent('TAG_ADDED', { tag: 'honeymoon' })).title).toContain(
      'honeymoon',
    );
    expect(formatLeadEvent(makeEvent('TAG_REMOVED', { tag: 'honeymoon' })).title).toContain(
      'Removed',
    );
  });

  it('QUOTE_SENT shows channel', () => {
    const out = formatLeadEvent(
      makeEvent('QUOTE_SENT', { quote_id: 'Q1', channel: 'EMAIL' }),
    );
    expect(out.title).toContain('EMAIL');
  });

  it('unknown event_type falls back gracefully (forward-compat)', () => {
    const out = formatLeadEvent({
      id: 'E1',
      lead_id: 'L1',
      hotel_id: 'H1',
      event_type: 'FUTURE_EVENT' as never,
      event_schema_version: 1,
      payload: {} as never,
      actor_id: null,
      occurred_at: '2026-05-25T14:00:00Z',
    } as never);
    expect(out.iconName).toBe('help-circle');
    expect(out.actor).toBe('unknown');
  });
});
