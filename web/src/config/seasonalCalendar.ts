// web/src/config/seasonalCalendar.ts
//
// Seasonal Demand Calendar v0 — feature flag, label dictionaries, disclaimer
// copy, and the TS mirror of the deterministic SQL urgency classifier.
//
// Toggle: flip SEASONAL_DEMAND_CALENDAR_V0_ENABLED = false to hide all
// surfaces (dashboard card + quick-nav tile + /owner/:slug/seasonal route).
//
// This is a PLANNING + READINESS workspace. It publishes nothing, calls no
// AI, scrapes no demand/booking data, and sends no campaigns. All urgency
// is deterministic and rule-based.

import type {
  SeasonalCategory,
  SeasonalConnectedModule,
  SeasonalPriority,
  SeasonalReviewStatus,
  SeasonalWindowUrgency,
} from '../types/seasonalCalendar';

export const SEASONAL_DEMAND_CALENDAR_V0_ENABLED = true;

// ── Disclaimer copy (verbatim per spec) ─────────────────────────────────────

export const SEASONAL_DISCLAIMER_EN =
  'Seasonal Demand Calendar is a planning guide based on common regional travel patterns. It does not guarantee bookings, occupancy, revenue, Google ranking, OTA reduction, or business growth.';

export const SEASONAL_DISCLAIMER_HI =
  'Yeh calendar prediction nahi hai. Yeh Uttarakhand aur baaki regions ke common travel seasons ke hisaab se planning aur preparation reminder hai. Bookings, occupancy, revenue, ya Google ranking ki koi guarantee nahi.';

// ── Category labels ─────────────────────────────────────────────────────────

export const SEASONAL_CATEGORY_LABEL: Record<SeasonalCategory, string> = {
  RELIGIOUS_YATRA:    'Religious / Yatra',
  METRO_ESCAPE:       'Metro Escape',
  CLIMATE_PEAK:       'Climate Peak',
  OFF_PEAK_VALUE:     'Off-peak Value',
  WINTER_SNOW:        'Winter / Snow',
  LONG_WEEKEND:       'Long Weekend',
  WELLNESS_WORKATION: 'Wellness / Workation',
  FAMILY_EVENT:       'Family Event',
};

export const SEASONAL_CATEGORY_LABEL_HI: Record<SeasonalCategory, string> = {
  RELIGIOUS_YATRA:    'Yatra / Religious',
  METRO_ESCAPE:       'Metro Escape',
  CLIMATE_PEAK:       'Climate Peak',
  OFF_PEAK_VALUE:     'Off-peak Value',
  WINTER_SNOW:        'Sardi / Snow',
  LONG_WEEKEND:       'Long Weekend',
  WELLNESS_WORKATION: 'Wellness / Workation',
  FAMILY_EVENT:       'Family Event',
};

export const SEASONAL_CATEGORY_ORDER: SeasonalCategory[] = [
  'RELIGIOUS_YATRA',
  'METRO_ESCAPE',
  'CLIMATE_PEAK',
  'OFF_PEAK_VALUE',
  'WINTER_SNOW',
  'LONG_WEEKEND',
  'WELLNESS_WORKATION',
  'FAMILY_EVENT',
];

// ── Priority labels / tones ─────────────────────────────────────────────────

export const SEASONAL_PRIORITY_LABEL: Record<SeasonalPriority, string> = {
  CRITICAL: 'Critical',
  HIGH:     'High',
  MEDIUM:   'Medium',
  LOW:      'Low',
};

// ── Review-status labels ────────────────────────────────────────────────────

export const SEASONAL_REVIEW_STATUS_LABEL: Record<SeasonalReviewStatus, string> = {
  PLANNING:  'Planning',
  READY:     'Ready',
  DISMISSED: 'Dismissed',
};

// ── Urgency labels / tones ──────────────────────────────────────────────────

export const SEASONAL_URGENCY_LABEL: Record<SeasonalWindowUrgency, string> = {
  NOW:     'Now',
  PREPARE: 'Prepare',
  WATCH:   'Watch',
  QUIET:   'Quiet',
};

export type UrgencyTone = 'rose' | 'amber' | 'sky' | 'slate';

export const SEASONAL_URGENCY_TONE: Record<SeasonalWindowUrgency, UrgencyTone> = {
  NOW:     'rose',
  PREPARE: 'amber',
  WATCH:   'sky',
  QUIET:   'slate',
};

// ── Connected-module labels (soft links; not all modules wired everywhere) ──

export const SEASONAL_CONNECTED_MODULE_LABEL: Record<SeasonalConnectedModule, string> = {
  PACKAGE_BUILDER: 'Package Builder',
  DRIP:            'Follow-up Drip',
  DAM:             'Asset Manager',
  SEO_PLANNER:     'Local SEO Planner',
};

/** Maps a connected-module hint to an in-app route under /owner/:slug/. */
export function seasonalConnectedModuleRoute(
  hotelSlug: string,
  module: SeasonalConnectedModule | null | undefined,
): string | null {
  if (!module) return null;
  switch (module) {
    case 'PACKAGE_BUILDER': return `/owner/${hotelSlug}/packages`;
    case 'DRIP':            return `/owner/${hotelSlug}/drip`;
    case 'DAM':             return `/owner/${hotelSlug}/assets`;
    case 'SEO_PLANNER':     return `/owner/${hotelSlug}/seo-planner`;
    default:                return null;
  }
}

// ── Deterministic urgency mirror (must match SQL _seasonal_window_urgency) ──
//
// The server is authoritative on read — every view row carries computed_urgency
// from the SQL function. This mirror exists for instant in-form feedback (the
// dashboard card during navigation, the override-preview modal). Parity is
// asserted by seasonalCalendarService.test.ts against a fixture matrix.

export function computeSeasonalUrgency(input: {
  nextStartTs: Date;
  nextEndTs: Date;
  at: Date;
}): SeasonalWindowUrgency {
  const { nextStartTs, nextEndTs, at } = input;
  if (at >= nextStartTs && at <= nextEndTs) return 'NOW';
  const daysUntil = Math.floor((nextStartTs.getTime() - at.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntil <= 7)  return 'NOW';
  if (daysUntil <= 30) return 'PREPARE';
  if (daysUntil <= 60) return 'WATCH';
  return 'QUIET';
}

// ── Days-until label (e.g. "in 18 days", "in 2 months", "active now") ───────

type DaysT = (key: string, en: string, vars?: Record<string, unknown>) => string;

export function formatDaysUntil(
  daysToStart: number,
  urgency: SeasonalWindowUrgency,
  t?: DaysT,
): string {
  const tr = (key: string, en: string, vars?: Record<string, unknown>) =>
    t ? t(key, en, vars) : en
      .replace('{{n}}', String(vars?.n ?? ''));
  if (urgency === 'NOW' && daysToStart <= 0) return tr('days.activeNow', 'Active now');
  if (daysToStart <= 0) return tr('days.activeNow', 'Active now');
  if (daysToStart === 1) return tr('days.oneDay', 'In 1 day');
  if (daysToStart <= 60) return tr('days.days', 'In {{n}} days', { n: daysToStart });
  const months = Math.round(daysToStart / 30);
  if (months <= 1) return tr('days.days', 'In {{n}} days', { n: daysToStart });
  return tr('days.months', 'In ~{{n}} months', { n: months });
}

// ── Approximate-window helpers ──────────────────────────────────────────────

const MONTH_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Renders a window's date range, distinguishing exact vs approximate.
 * Exact: "Jan 23 – Jan 28". Approximate: "Around late Apr – late May".
 */
export function formatWindowRange(input: {
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
  isApproximate: boolean;
}, t?: DaysT): string {
  const { startMonth, startDay, endMonth, endDay, isApproximate } = input;
  if (!isApproximate) {
    return `${MONTH_SHORT_EN[startMonth - 1]} ${startDay} – ${MONTH_SHORT_EN[endMonth - 1]} ${endDay}`;
  }
  // For approximate windows, soften to monthly resolution with early/mid/late.
  const dayHint = (d: number): string => {
    const key = d <= 10 ? 'early' : d <= 20 ? 'mid' : 'late';
    return t ? t(`approxDay.${key}`, key) : key;
  };
  return `Around ${dayHint(startDay)} ${MONTH_SHORT_EN[startMonth - 1]} – ${dayHint(endDay)} ${MONTH_SHORT_EN[endMonth - 1]}`;
}
