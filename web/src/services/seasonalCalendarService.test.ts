// Unit tests for client-side invariants. The server is authoritative on
// urgency (view computed_urgency), but the TS mirror must match exactly to
// avoid flicker on first paint vs after refetch.

import { describe, it, expect } from 'vitest';
import {
  computeSeasonalUrgency,
  formatDaysUntil,
  formatWindowRange,
  seasonalConnectedModuleRoute,
  SEASONAL_DEMAND_CALENDAR_V0_ENABLED,
  SEASONAL_DISCLAIMER_EN,
  SEASONAL_DISCLAIMER_HI,
} from '../config/seasonalCalendar';
import {
  extractSeasonalErrorCode,
  friendlySeasonalError,
  summarizeSeasonalCalendar,
} from './seasonalCalendarService';
import type { VisibleSeasonalWindow } from '../types/seasonalCalendar';

// ──────────────────────────────────────────────────────────────────────────
// Flag + disclaimer sanity (catches accidental edits to verbatim copy)
// ──────────────────────────────────────────────────────────────────────────

describe('seasonalCalendar config', () => {
  it('ships with the feature flag enabled', () => {
    expect(SEASONAL_DEMAND_CALENDAR_V0_ENABLED).toBe(true);
  });

  it('disclaimer copy is verbatim per spec (EN)', () => {
    expect(SEASONAL_DISCLAIMER_EN).toContain('planning guide');
    expect(SEASONAL_DISCLAIMER_EN).toContain('does not guarantee');
    expect(SEASONAL_DISCLAIMER_EN).toContain('bookings');
    expect(SEASONAL_DISCLAIMER_EN).toContain('Google ranking');
  });

  it('disclaimer copy is verbatim per spec (Hinglish)', () => {
    expect(SEASONAL_DISCLAIMER_HI).toContain('prediction nahi');
    expect(SEASONAL_DISCLAIMER_HI).toContain('guarantee nahi');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Urgency math — TS mirror MUST agree with SQL _seasonal_window_urgency on
// these fixtures. If you change the SQL function, update both sides + this
// matrix so we never silently diverge.
// ──────────────────────────────────────────────────────────────────────────

const D = (s: string): Date => new Date(s);

describe('computeSeasonalUrgency — SQL parity fixtures', () => {
  it('returns NOW when at-time is inside the window', () => {
    expect(
      computeSeasonalUrgency({
        nextStartTs: D('2026-05-25T00:00:00+05:30'),
        nextEndTs:   D('2026-08-15T23:59:59+05:30'),
        at:          D('2026-06-15T12:00:00+05:30'),
      }),
    ).toBe('NOW');
  });

  it('returns NOW when starts in ≤ 7 days', () => {
    expect(
      computeSeasonalUrgency({
        nextStartTs: D('2026-04-20T00:00:00+05:30'),
        nextEndTs:   D('2026-05-25T23:59:59+05:30'),
        at:          D('2026-04-15T12:00:00+05:30'), // 4 days before
      }),
    ).toBe('NOW');
  });

  it('returns PREPARE when starts in 8–30 days', () => {
    expect(
      computeSeasonalUrgency({
        nextStartTs: D('2026-04-20T00:00:00+05:30'),
        nextEndTs:   D('2026-05-25T23:59:59+05:30'),
        at:          D('2026-03-25T12:00:00+05:30'), // ~26 days before
      }),
    ).toBe('PREPARE');
  });

  it('returns WATCH when starts in 31–60 days', () => {
    expect(
      computeSeasonalUrgency({
        nextStartTs: D('2026-04-20T00:00:00+05:30'),
        nextEndTs:   D('2026-05-25T23:59:59+05:30'),
        at:          D('2026-03-01T12:00:00+05:30'), // ~50 days before
      }),
    ).toBe('WATCH');
  });

  it('returns QUIET when starts in 61+ days', () => {
    expect(
      computeSeasonalUrgency({
        nextStartTs: D('2026-04-20T00:00:00+05:30'),
        nextEndTs:   D('2026-05-25T23:59:59+05:30'),
        at:          D('2026-01-01T12:00:00+05:30'), // 109 days before
      }),
    ).toBe('QUIET');
  });

  it('handles cross-year window when currently active', () => {
    expect(
      computeSeasonalUrgency({
        nextStartTs: D('2025-12-10T00:00:00+05:30'),
        nextEndTs:   D('2026-02-25T23:59:59+05:30'),
        at:          D('2026-01-15T12:00:00+05:30'),
      }),
    ).toBe('NOW');
  });

  it('handles cross-year window when starts in 5 days', () => {
    expect(
      computeSeasonalUrgency({
        nextStartTs: D('2026-12-10T00:00:00+05:30'),
        nextEndTs:   D('2027-02-25T23:59:59+05:30'),
        at:          D('2026-12-05T12:00:00+05:30'),
      }),
    ).toBe('NOW');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// formatDaysUntil
// ──────────────────────────────────────────────────────────────────────────

describe('formatDaysUntil', () => {
  it('returns "Active now" for 0-day NOW', () => {
    expect(formatDaysUntil(0, 'NOW')).toBe('Active now');
  });
  it('singular "In 1 day"', () => {
    expect(formatDaysUntil(1, 'NOW')).toBe('In 1 day');
  });
  it('plural "In N days" for short ranges', () => {
    expect(formatDaysUntil(18, 'PREPARE')).toBe('In 18 days');
  });
  it('boundary at 60 days stays in days form', () => {
    expect(formatDaysUntil(60, 'WATCH')).toBe('In 60 days');
  });
  it('uses approximate months past 60 days', () => {
    expect(formatDaysUntil(90, 'QUIET')).toBe('In ~3 months');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// formatWindowRange — approximate softens dates
// ──────────────────────────────────────────────────────────────────────────

describe('formatWindowRange', () => {
  it('renders exact ranges crisply', () => {
    expect(
      formatWindowRange({
        startMonth: 1,
        startDay: 23,
        endMonth: 1,
        endDay: 28,
        isApproximate: false,
      }),
    ).toBe('Jan 23 – Jan 28');
  });

  it('softens approximate ranges to "early/mid/late <Month>"', () => {
    expect(
      formatWindowRange({
        startMonth: 4,
        startDay: 20,
        endMonth: 5,
        endDay: 25,
        isApproximate: true,
      }),
    ).toBe('Around mid Apr – late May');
  });

  it('handles cross-year approximate windows', () => {
    expect(
      formatWindowRange({
        startMonth: 12,
        startDay: 10,
        endMonth: 2,
        endDay: 25,
        isApproximate: true,
      }),
    ).toBe('Around early Dec – late Feb');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Connected module route mapping
// ──────────────────────────────────────────────────────────────────────────

describe('seasonalConnectedModuleRoute', () => {
  it('maps PACKAGE_BUILDER to /owner/:slug/packages', () => {
    expect(seasonalConnectedModuleRoute('tenant1', 'PACKAGE_BUILDER')).toBe(
      '/owner/tenant1/packages',
    );
  });
  it('maps DAM to /owner/:slug/assets', () => {
    expect(seasonalConnectedModuleRoute('tenant1', 'DAM')).toBe('/owner/tenant1/assets');
  });
  it('maps SEO_PLANNER to /owner/:slug/seo-planner', () => {
    expect(seasonalConnectedModuleRoute('tenant1', 'SEO_PLANNER')).toBe(
      '/owner/tenant1/seo-planner',
    );
  });
  it('returns null when no module suggested', () => {
    expect(seasonalConnectedModuleRoute('tenant1', null)).toBeNull();
    expect(seasonalConnectedModuleRoute('tenant1', undefined)).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Error extraction + friendly mapping
// ──────────────────────────────────────────────────────────────────────────

describe('extractSeasonalErrorCode', () => {
  it('extracts known codes from error messages', () => {
    expect(extractSeasonalErrorCode(new Error('NOT_AUTHORIZED'))).toBe('NOT_AUTHORIZED');
    expect(extractSeasonalErrorCode(new Error('OVERRIDE_REASON_REQUIRED: Add reason'))).toBe(
      'OVERRIDE_REASON_REQUIRED',
    );
    expect(extractSeasonalErrorCode(new Error('Failed: WINDOW_NOT_FOUND tail'))).toBe(
      'WINDOW_NOT_FOUND',
    );
  });
  it('returns null for unknown codes', () => {
    expect(extractSeasonalErrorCode(new Error('Random thing happened'))).toBeNull();
    expect(extractSeasonalErrorCode(null)).toBeNull();
    expect(extractSeasonalErrorCode(undefined)).toBeNull();
  });
});

describe('friendlySeasonalError', () => {
  it('rewrites OVERRIDE_REASON_REQUIRED with owner-friendly copy', () => {
    expect(friendlySeasonalError('OVERRIDE_REASON_REQUIRED', 'raw').toLowerCase()).toContain('reason');
  });
  it('rewrites NOT_AUTHORIZED to suggest escalation', () => {
    const msg = friendlySeasonalError('NOT_AUTHORIZED', 'raw');
    expect(msg.toLowerCase()).toContain('permission');
  });
  it('returns fallback when code is null', () => {
    expect(friendlySeasonalError(null, 'fallback text')).toBe('fallback text');
  });
  it('returns fallback for UNKNOWN_ERROR', () => {
    expect(friendlySeasonalError('UNKNOWN_ERROR', 'fallback text')).toBe('fallback text');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// summarizeSeasonalCalendar
// ──────────────────────────────────────────────────────────────────────────

function fakeWindow(overrides: Partial<VisibleSeasonalWindow>): VisibleSeasonalWindow {
  return {
    hotel_id: 'h',
    hotel_slug: 'tenant1',
    hotel_state: 'Uttarakhand',
    window_code: overrides.window_code ?? 'CODE',
    category: 'RELIGIOUS_YATRA',
    display_name_en: 'X',
    display_name_hi: 'X',
    why_it_matters_en: 'why',
    why_it_matters_hi: 'why',
    recommended_action_en: 'do',
    recommended_action_hi: 'do',
    target_guest_segment_en: null,
    target_guest_segment_hi: null,
    suggested_package_idea_en: null,
    suggested_package_idea_hi: null,
    start_month: 4, start_day: 20, end_month: 5, end_day: 25,
    region_state_codes: [],
    priority: 'MEDIUM',
    prep_checklist_seed: [],
    connected_module_suggestion: null,
    is_approximate: true,
    date_disclaimer_en: null,
    date_disclaimer_hi: null,
    display_order: 100,
    season_year: 2026,
    next_start_ts: '2026-04-20T00:00:00+05:30',
    next_end_ts:   '2026-05-25T23:59:59+05:30',
    days_to_start: overrides.days_to_start ?? 18,
    is_regional_match: true,
    state_id: null,
    review_status: overrides.review_status ?? 'PLANNING',
    ticked_keys: [],
    owner_notes: null,
    internal_notes: null,
    urgency_override: null,
    urgency_override_reason: null,
    dismissed_reason: null,
    is_permanently_hidden: overrides.is_permanently_hidden ?? false,
    permanently_hidden_reason: null,
    marked_ready_at: null,
    marked_ready_by: null,
    computed_urgency: overrides.computed_urgency ?? 'PREPARE',
    checklist_total: 0,
    checklist_done: 0,
    state_created_at: null,
    state_updated_at: null,
    state_updated_by: null,
    ...overrides,
  };
}

describe('summarizeSeasonalCalendar', () => {
  it('picks the highest-urgency window as topWindow', () => {
    const sum = summarizeSeasonalCalendar([
      fakeWindow({ window_code: 'A', computed_urgency: 'QUIET',   days_to_start: 200 }),
      fakeWindow({ window_code: 'B', computed_urgency: 'NOW',     days_to_start: 0 }),
      fakeWindow({ window_code: 'C', computed_urgency: 'PREPARE', days_to_start: 20 }),
    ]);
    expect(sum.topWindow?.window_code).toBe('B');
  });

  it('breaks ties on days_to_start (sooner first)', () => {
    const sum = summarizeSeasonalCalendar([
      fakeWindow({ window_code: 'A', computed_urgency: 'PREPARE', days_to_start: 25 }),
      fakeWindow({ window_code: 'B', computed_urgency: 'PREPARE', days_to_start: 10 }),
    ]);
    expect(sum.topWindow?.window_code).toBe('B');
  });

  it('excludes dismissed and permanently hidden from topWindow', () => {
    const sum = summarizeSeasonalCalendar([
      fakeWindow({ window_code: 'A', computed_urgency: 'NOW', days_to_start: 0, review_status: 'DISMISSED' }),
      fakeWindow({ window_code: 'B', computed_urgency: 'NOW', days_to_start: 0, is_permanently_hidden: true }),
      fakeWindow({ window_code: 'C', computed_urgency: 'PREPARE', days_to_start: 20 }),
    ]);
    expect(sum.topWindow?.window_code).toBe('C');
  });

  it('counts dismissed separately for the byReviewStatus dictionary', () => {
    const sum = summarizeSeasonalCalendar([
      fakeWindow({ window_code: 'A', review_status: 'DISMISSED' }),
      fakeWindow({ window_code: 'B', review_status: 'PLANNING' }),
      fakeWindow({ window_code: 'C', review_status: 'READY' }),
    ]);
    expect(sum.byReviewStatus.DISMISSED).toBe(1);
    expect(sum.byReviewStatus.PLANNING).toBe(1);
    expect(sum.byReviewStatus.READY).toBe(1);
    // total excludes dismissed
    expect(sum.total).toBe(2);
  });

  it('aggregates urgency counts across all non-dismissed visible rows', () => {
    const sum = summarizeSeasonalCalendar([
      fakeWindow({ window_code: 'A', computed_urgency: 'NOW' }),
      fakeWindow({ window_code: 'B', computed_urgency: 'NOW' }),
      fakeWindow({ window_code: 'C', computed_urgency: 'QUIET' }),
      fakeWindow({ window_code: 'D', computed_urgency: 'PREPARE', review_status: 'DISMISSED' }),
    ]);
    expect(sum.byUrgency.NOW).toBe(2);
    expect(sum.byUrgency.QUIET).toBe(1);
    expect(sum.byUrgency.PREPARE).toBeUndefined();
  });
});
