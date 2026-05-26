import { describe, expect, it } from 'vitest';
import {
  HEARTBEAT_INTERVAL_MS,
  shouldHeartbeat,
  isForcedReleaseEvent,
} from './useLeadClaimLifecycle';
import type { ClaimStatus } from '../types/lead';

const selfHeldClaim: ClaimStatus = {
  ok: true,
  claimed_by: 'U1',
  claimed_by_name: 'priya',
  claimed_at: '2026-05-25T14:00:00Z',
  claim_expires_at: '2026-05-25T14:15:00Z',
  is_expired: false,
  is_self: true,
};

const otherHeldClaim: ClaimStatus = {
  ...selfHeldClaim,
  claimed_by: 'U2',
  claimed_by_name: 'raj',
  is_self: false,
};

const expiredClaim: ClaimStatus = { ...selfHeldClaim, is_expired: true };
const unclaimedState: ClaimStatus = {
  ok: true,
  claimed_by: null,
  claimed_by_name: null,
  claimed_at: null,
  claim_expires_at: null,
  is_expired: true,
  is_self: false,
};

describe('HEARTBEAT_INTERVAL_MS', () => {
  it('is set to 10 minutes (5-min buffer against 15-min TTL)', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(10 * 60 * 1000);
  });
});

describe('shouldHeartbeat', () => {
  it('returns true when self-held and not paused', () => {
    expect(shouldHeartbeat(selfHeldClaim, false)).toBe(true);
  });
  it('returns false when paused', () => {
    expect(shouldHeartbeat(selfHeldClaim, true)).toBe(false);
  });
  it('returns false when claim is held by another', () => {
    expect(shouldHeartbeat(otherHeldClaim, false)).toBe(false);
  });
  it('returns false when claim is expired', () => {
    expect(shouldHeartbeat(expiredClaim, false)).toBe(false);
  });
  it('returns false when no claim state', () => {
    expect(shouldHeartbeat(null, false)).toBe(false);
  });
  it('returns false for unclaimed lead', () => {
    expect(shouldHeartbeat(unclaimedState, false)).toBe(false);
  });
});

describe('isForcedReleaseEvent', () => {
  it('returns true when CLAIM_RELEASED + forced + prev_holder matches currentUser', () => {
    expect(
      isForcedReleaseEvent(
        {
          event_type: 'CLAIM_RELEASED',
          payload: { release_type: 'forced', prev_holder: 'U1' },
        },
        'U1',
      ),
    ).toBe(true);
  });

  it('returns false when release_type=manual', () => {
    expect(
      isForcedReleaseEvent(
        {
          event_type: 'CLAIM_RELEASED',
          payload: { release_type: 'manual', prev_holder: 'U1' },
        },
        'U1',
      ),
    ).toBe(false);
  });

  it('returns false when release_type=auto_on_convert', () => {
    expect(
      isForcedReleaseEvent(
        {
          event_type: 'CLAIM_RELEASED',
          payload: { release_type: 'auto_on_convert', prev_holder: 'U1' },
        },
        'U1',
      ),
    ).toBe(false);
  });

  it('returns false when prev_holder is a different user', () => {
    expect(
      isForcedReleaseEvent(
        {
          event_type: 'CLAIM_RELEASED',
          payload: { release_type: 'forced', prev_holder: 'OTHER' },
        },
        'U1',
      ),
    ).toBe(false);
  });

  it('returns false when currentUserId is null', () => {
    expect(
      isForcedReleaseEvent(
        {
          event_type: 'CLAIM_RELEASED',
          payload: { release_type: 'forced', prev_holder: 'U1' },
        },
        null,
      ),
    ).toBe(false);
  });

  it('returns false for non-CLAIM_RELEASED event types', () => {
    expect(
      isForcedReleaseEvent(
        {
          event_type: 'STATUS_CHANGED',
          payload: { release_type: 'forced', prev_holder: 'U1' },
        },
        'U1',
      ),
    ).toBe(false);
  });
});
