// web/src/hooks/useLeadsRealtime.test.ts
//
// Tests for the pure helper functions extracted from useLeadsRealtime.
// Full useEffect lifecycle tests (mount/unmount/cleanup) are out of scope —
// they would require @testing-library/react + jsdom which aren't in the repo.
// The thin React wrapper around supabase.channel is verified manually in
// Day 6+ when UI consumes it.
//
// Trigger to add testing-library: when a hook has non-trivial state-machine
// logic beyond the current "subscribe + invalidate" pattern.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import {
  LIST_INVALIDATING_EVENT_TYPES,
  MAX_CONSECUTIVE_ERRORS,
  REALTIME_DEBOUNCE_MS,
  createDebouncedInvalidator,
  getListInvalidationKeys,
} from './useLeadsRealtime';

describe('LIST_INVALIDATING_EVENT_TYPES', () => {
  it('includes events that affect list/kanban views', () => {
    expect(LIST_INVALIDATING_EVENT_TYPES.has('CREATED')).toBe(true);
    expect(LIST_INVALIDATING_EVENT_TYPES.has('STATUS_CHANGED')).toBe(true);
    expect(LIST_INVALIDATING_EVENT_TYPES.has('ASSIGNED')).toBe(true);
    expect(LIST_INVALIDATING_EVENT_TYPES.has('UNASSIGNED')).toBe(true);
    expect(LIST_INVALIDATING_EVENT_TYPES.has('CLAIMED')).toBe(true);
    expect(LIST_INVALIDATING_EVENT_TYPES.has('CLAIM_RELEASED')).toBe(true);
    expect(LIST_INVALIDATING_EVENT_TYPES.has('CONVERTED_TO_BOOKING')).toBe(true);
    expect(LIST_INVALIDATING_EVENT_TYPES.has('SOFT_DELETED')).toBe(true);
    expect(LIST_INVALIDATING_EVENT_TYPES.has('REOPENED')).toBe(true);
  });

  it('EXCLUDES events that only affect lead detail (refetched on demand)', () => {
    expect(LIST_INVALIDATING_EVENT_TYPES.has('NOTE_ADDED')).toBe(false);
    expect(LIST_INVALIDATING_EVENT_TYPES.has('CONTACT_UPDATED')).toBe(false);
    expect(LIST_INVALIDATING_EVENT_TYPES.has('BASICS_UPDATED')).toBe(false);
    expect(LIST_INVALIDATING_EVENT_TYPES.has('TAG_ADDED')).toBe(false);
    expect(LIST_INVALIDATING_EVENT_TYPES.has('TAG_REMOVED')).toBe(false);
    expect(LIST_INVALIDATING_EVENT_TYPES.has('QUOTE_SENT')).toBe(false);
  });
});

describe('MAX_CONSECUTIVE_ERRORS', () => {
  it('is set to a sensible threshold (>1 to tolerate transient blips, <10 to not lag)', () => {
    expect(MAX_CONSECUTIVE_ERRORS).toBeGreaterThanOrEqual(2);
    expect(MAX_CONSECUTIVE_ERRORS).toBeLessThanOrEqual(10);
  });
});

describe('getListInvalidationKeys', () => {
  it('returns no keys for non-invalidating event types', () => {
    expect(getListInvalidationKeys({ event_type: 'NOTE_ADDED', lead_id: 'L1' }, 'H1')).toEqual([]);
    expect(getListInvalidationKeys({ event_type: 'TAG_ADDED', lead_id: 'L1' }, 'H1')).toEqual([]);
  });

  it('returns no keys for unknown event_type (forward-compat)', () => {
    expect(getListInvalidationKeys({ event_type: 'FUTURE_TYPE', lead_id: 'L1' }, 'H1')).toEqual(
      [],
    );
  });

  it('returns no keys when event_type is missing', () => {
    expect(getListInvalidationKeys({ lead_id: 'L1' }, 'H1')).toEqual([]);
  });

  it('returns all hotel-scope + lead-scope keys for invalidating event type with lead_id', () => {
    const keys = getListInvalidationKeys(
      { event_type: 'STATUS_CHANGED', lead_id: 'L1' },
      'H1',
    );
    // Day 11: hotel-scope expanded to include list + kanban + open-summary
    expect(keys).toEqual([
      ['leads', 'H1'],
      ['leads-kanban', 'H1'],
      ['leads-open-summary', 'H1'],
      ['lead', 'L1'],
      ['lead-events', 'L1'],
      ['lead-claim', 'L1'],
    ]);
  });

  it('returns all hotel-scope keys when lead_id is missing', () => {
    const keys = getListInvalidationKeys({ event_type: 'STATUS_CHANGED' }, 'H1');
    expect(keys).toEqual([
      ['leads', 'H1'],
      ['leads-kanban', 'H1'],
      ['leads-open-summary', 'H1'],
    ]);
  });

  it('covers every list-invalidating event type', () => {
    for (const eventType of LIST_INVALIDATING_EVENT_TYPES) {
      const keys = getListInvalidationKeys({ event_type: eventType, lead_id: 'L1' }, 'H1');
      expect(keys.length).toBeGreaterThan(0);
    }
  });
});

describe('REALTIME_DEBOUNCE_MS', () => {
  it('is set to a sensible value (between 100ms and 1s)', () => {
    expect(REALTIME_DEBOUNCE_MS).toBeGreaterThanOrEqual(100);
    expect(REALTIME_DEBOUNCE_MS).toBeLessThanOrEqual(1000);
  });
});

describe('createDebouncedInvalidator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeMockClient() {
    const invalidateQueries = vi.fn();
    return {
      client: { invalidateQueries } as unknown as QueryClient,
      invalidateQueries,
    };
  }

  it('coalesces rapid calls into 1 invocation per key after the delay', () => {
    const { client, invalidateQueries } = makeMockClient();
    const debounced = createDebouncedInvalidator(client, 250);

    // 5 rapid calls within the debounce window
    debounced([['leads', 'H1']]);
    debounced([['leads', 'H1']]);
    debounced([['leads', 'H1']]);
    debounced([['leads', 'H1']]);
    debounced([['leads', 'H1']]);

    expect(invalidateQueries).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['leads', 'H1'] });
  });

  it('resets timer on each call (last-call-wins)', () => {
    const { client, invalidateQueries } = makeMockClient();
    const debounced = createDebouncedInvalidator(client, 250);

    debounced([['leads', 'H1']]);
    vi.advanceTimersByTime(200);          // not yet
    debounced([['leads', 'H1']]);          // reset timer
    vi.advanceTimersByTime(200);          // still 50ms short
    expect(invalidateQueries).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it('invalidates the union of all collected keys after the delay', () => {
    const { client, invalidateQueries } = makeMockClient();
    const debounced = createDebouncedInvalidator(client, 250);

    debounced([['leads', 'H1'], ['lead', 'L1']]);
    debounced([['lead-events', 'L1'], ['lead', 'L1']]);   // L1 dedup'd

    vi.advanceTimersByTime(250);
    expect(invalidateQueries).toHaveBeenCalledTimes(3);
    const calledKeys = invalidateQueries.mock.calls.map((c) => c[0].queryKey);
    expect(calledKeys).toContainEqual(['leads', 'H1']);
    expect(calledKeys).toContainEqual(['lead', 'L1']);
    expect(calledKeys).toContainEqual(['lead-events', 'L1']);
  });

  it('after firing, accepts new bursts independently', () => {
    const { client, invalidateQueries } = makeMockClient();
    const debounced = createDebouncedInvalidator(client, 250);

    debounced([['leads', 'H1']]);
    vi.advanceTimersByTime(250);
    expect(invalidateQueries).toHaveBeenCalledTimes(1);

    debounced([['leads', 'H1']]);
    vi.advanceTimersByTime(250);
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });
});
