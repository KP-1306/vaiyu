// web/src/config/followUpRadar.test.ts
//
// Unit tests for the pure helpers that drive the Follow-up Radar v0 UI.
// Everything in this file is deterministic — given a fixed `now`, the helpers
// must always return the same buckets/counts/sort order.

import { describe, expect, it } from 'vitest';
import {
  bucketFor,
  buildMockItems,
  countByBucket,
  groupByBucket,
  isDueToday,
  isOverdue,
  sortByPriority,
  todayIsoLocal,
} from './followUpRadar';
import type { FollowUpItem } from '../types/followUp';

function mkItem(overrides: Partial<FollowUpItem>): FollowUpItem {
  return {
    id: overrides.id ?? 'fu-test',
    category: 'DIRECT_ENQUIRY',
    status: 'PENDING',
    priority: 'MEDIUM',
    title: 'Test',
    context: 'Test context',
    entityReference: 'lead-test-1',
    dueAt: '2026-05-26',
    assignedTo: null,
    blockedReason: null,
    relatedTicketStatus: 'NONE',
    recommendedManualAction: 'Do something.',
    ...overrides,
  };
}

describe('todayIsoLocal', () => {
  it('formats as YYYY-MM-DD using local time', () => {
    const d = new Date(2026, 4, 26, 14, 30); // May 26 2026 14:30 local
    expect(todayIsoLocal(d)).toBe('2026-05-26');
  });

  it('pads single-digit month and day', () => {
    const d = new Date(2026, 0, 9, 0, 0);
    expect(todayIsoLocal(d)).toBe('2026-01-09');
  });
});

describe('isDueToday', () => {
  const now = new Date(2026, 4, 26);
  it('true when dueAt equals today (local)', () => {
    expect(isDueToday('2026-05-26', now)).toBe(true);
  });
  it('false when dueAt is past', () => {
    expect(isDueToday('2026-05-25', now)).toBe(false);
  });
  it('false when dueAt is future', () => {
    expect(isDueToday('2026-05-27', now)).toBe(false);
  });
});

describe('isOverdue', () => {
  const now = new Date(2026, 4, 26);
  it('true when dueAt is past today', () => {
    expect(isOverdue('2026-05-25', now)).toBe(true);
  });
  it('false when dueAt equals today', () => {
    expect(isOverdue('2026-05-26', now)).toBe(false);
  });
  it('false when dueAt is future', () => {
    expect(isOverdue('2026-05-27', now)).toBe(false);
  });
});

describe('sortByPriority', () => {
  it('orders CRITICAL > HIGH > MEDIUM > LOW', () => {
    const items = [
      mkItem({ id: 'a', priority: 'LOW' }),
      mkItem({ id: 'b', priority: 'CRITICAL' }),
      mkItem({ id: 'c', priority: 'MEDIUM' }),
      mkItem({ id: 'd', priority: 'HIGH' }),
    ];
    const sorted = [...items].sort(sortByPriority).map((i) => i.id);
    expect(sorted).toEqual(['b', 'd', 'c', 'a']);
  });

  it('tie-breaks ties by earlier dueAt first', () => {
    const items = [
      mkItem({ id: 'late', priority: 'HIGH', dueAt: '2026-05-30' }),
      mkItem({ id: 'early', priority: 'HIGH', dueAt: '2026-05-20' }),
      mkItem({ id: 'mid', priority: 'HIGH', dueAt: '2026-05-25' }),
    ];
    const sorted = [...items].sort(sortByPriority).map((i) => i.id);
    expect(sorted).toEqual(['early', 'mid', 'late']);
  });
});

describe('bucketFor', () => {
  const now = new Date(2026, 4, 26);

  it('returns ADDRESSED when status is ADDRESSED (even if overdue)', () => {
    expect(
      bucketFor(mkItem({ status: 'ADDRESSED', dueAt: '2026-05-01' }), now),
    ).toBe('ADDRESSED');
  });

  it('returns BLOCKED when status is BLOCKED', () => {
    expect(bucketFor(mkItem({ status: 'BLOCKED', dueAt: '2026-05-26' }), now)).toBe(
      'BLOCKED',
    );
  });

  it('returns BLOCKED when blockedReason is set (regardless of status)', () => {
    expect(
      bucketFor(
        mkItem({ status: 'DUE', dueAt: '2026-05-26', blockedReason: 'open complaint' }),
        now,
      ),
    ).toBe('BLOCKED');
  });

  it('returns OVERDUE when dueAt is in the past and not blocked/addressed', () => {
    expect(bucketFor(mkItem({ status: 'DUE', dueAt: '2026-05-20' }), now)).toBe(
      'OVERDUE',
    );
  });

  it('returns DUE_TODAY when dueAt is today and not blocked/addressed', () => {
    expect(bucketFor(mkItem({ status: 'DUE', dueAt: '2026-05-26' }), now)).toBe(
      'DUE_TODAY',
    );
  });

  it('returns PENDING when dueAt is in the future and not blocked/addressed', () => {
    expect(bucketFor(mkItem({ status: 'PENDING', dueAt: '2026-06-01' }), now)).toBe(
      'PENDING',
    );
  });
});

describe('groupByBucket', () => {
  it('returns all buckets with items sorted by priority within each', () => {
    const now = new Date(2026, 4, 26);
    const items: FollowUpItem[] = [
      mkItem({ id: 't1', status: 'DUE', dueAt: '2026-05-26', priority: 'MEDIUM' }),
      mkItem({ id: 't2', status: 'DUE', dueAt: '2026-05-26', priority: 'CRITICAL' }),
      mkItem({ id: 'o1', status: 'OVERDUE', dueAt: '2026-05-20', priority: 'HIGH' }),
      mkItem({
        id: 'b1',
        status: 'BLOCKED',
        dueAt: '2026-05-26',
        priority: 'CRITICAL',
        blockedReason: 'complaint',
      }),
      mkItem({ id: 'a1', status: 'ADDRESSED', dueAt: '2026-05-25', priority: 'LOW' }),
      mkItem({ id: 'p1', status: 'PENDING', dueAt: '2026-06-15', priority: 'LOW' }),
    ];
    const out = groupByBucket(items, now);
    expect(out.DUE_TODAY.map((i) => i.id)).toEqual(['t2', 't1']); // critical first
    expect(out.OVERDUE.map((i) => i.id)).toEqual(['o1']);
    expect(out.BLOCKED.map((i) => i.id)).toEqual(['b1']);
    expect(out.ADDRESSED.map((i) => i.id)).toEqual(['a1']);
    expect(out.PENDING.map((i) => i.id)).toEqual(['p1']);
  });

  it('returns empty arrays for buckets with no items', () => {
    const out = groupByBucket([], new Date(2026, 4, 26));
    expect(out.DUE_TODAY).toEqual([]);
    expect(out.OVERDUE).toEqual([]);
    expect(out.BLOCKED).toEqual([]);
    expect(out.PENDING).toEqual([]);
    expect(out.ADDRESSED).toEqual([]);
  });
});

describe('countByBucket', () => {
  it('returns zero counts on empty input', () => {
    const out = countByBucket([], new Date(2026, 4, 26));
    expect(out).toEqual({
      dueToday: 0,
      overdue: 0,
      blocked: 0,
      pending: 0,
      addressed: 0,
      total: 0,
      criticalUnaddressed: 0,
    });
  });

  it('counts critical-unaddressed across DUE_TODAY / OVERDUE / BLOCKED only', () => {
    const now = new Date(2026, 4, 26);
    const items: FollowUpItem[] = [
      mkItem({ id: 'c1', status: 'DUE', dueAt: '2026-05-26', priority: 'CRITICAL' }),
      mkItem({ id: 'c2', status: 'OVERDUE', dueAt: '2026-05-20', priority: 'CRITICAL' }),
      mkItem({
        id: 'c3',
        status: 'BLOCKED',
        dueAt: '2026-05-26',
        priority: 'CRITICAL',
        blockedReason: 'x',
      }),
      // CRITICAL in PENDING bucket — must NOT count
      mkItem({ id: 'c4', status: 'PENDING', dueAt: '2026-06-15', priority: 'CRITICAL' }),
      // CRITICAL in ADDRESSED bucket — must NOT count
      mkItem({ id: 'c5', status: 'ADDRESSED', dueAt: '2026-05-25', priority: 'CRITICAL' }),
      // Non-critical OVERDUE — must NOT count
      mkItem({ id: 'h1', status: 'OVERDUE', dueAt: '2026-05-22', priority: 'HIGH' }),
    ];
    const out = countByBucket(items, now);
    expect(out.criticalUnaddressed).toBe(3);
    expect(out.dueToday).toBe(1);
    expect(out.overdue).toBe(2); // c2 + h1
    expect(out.blocked).toBe(1);
    expect(out.pending).toBe(1);
    expect(out.addressed).toBe(1);
    expect(out.total).toBe(6);
  });
});

describe('buildMockItems', () => {
  it('produces 10 items with all 5 statuses represented', () => {
    const items = buildMockItems(new Date(2026, 4, 26));
    expect(items.length).toBe(10);
    const statuses = new Set(items.map((i) => i.status));
    expect(statuses.has('PENDING')).toBe(true);
    expect(statuses.has('DUE')).toBe(true);
    expect(statuses.has('OVERDUE')).toBe(true);
    expect(statuses.has('BLOCKED')).toBe(true);
    expect(statuses.has('ADDRESSED')).toBe(true);
  });

  it('produces items that distribute across due-today / overdue / blocked / pending', () => {
    const now = new Date(2026, 4, 26);
    const counts = countByBucket(buildMockItems(now), now);
    // At least one item in each meaningful bucket so the radar has signal.
    expect(counts.dueToday).toBeGreaterThan(0);
    expect(counts.overdue).toBeGreaterThan(0);
    expect(counts.blocked).toBeGreaterThan(0);
    expect(counts.pending).toBeGreaterThan(0);
  });

  it('blocked items carry a non-empty blockedReason', () => {
    const items = buildMockItems(new Date(2026, 4, 26));
    const blocked = items.filter((i) => i.status === 'BLOCKED');
    expect(blocked.length).toBeGreaterThan(0);
    for (const b of blocked) {
      expect(b.blockedReason).toBeTruthy();
      expect(b.relatedTicketStatus).not.toBe('NONE');
    }
  });

  it('every mock item carries a synthetic entityReference (no real UUIDs)', () => {
    const items = buildMockItems(new Date(2026, 4, 26));
    for (const it of items) {
      // Refs should not look like UUIDs (8-4-4-4-12 hex). They follow `mock-*` shape.
      expect(it.entityReference).not.toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(it.entityReference.toLowerCase()).toContain('mock');
    }
  });
});
