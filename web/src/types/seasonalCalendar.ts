// web/src/types/seasonalCalendar.ts
//
// Seasonal Demand Calendar v0 — types only.
// Mirrors the DB schema from migration 20260530000001_seasonal_demand_calendar.sql.

export type SeasonalCategory =
  | 'RELIGIOUS_YATRA'
  | 'METRO_ESCAPE'
  | 'CLIMATE_PEAK'
  | 'OFF_PEAK_VALUE'
  | 'WINTER_SNOW'
  | 'LONG_WEEKEND'
  | 'WELLNESS_WORKATION'
  | 'FAMILY_EVENT';

export type SeasonalPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type SeasonalReviewStatus = 'PLANNING' | 'READY' | 'DISMISSED';

export type SeasonalWindowUrgency = 'NOW' | 'PREPARE' | 'WATCH' | 'QUIET';

export type SeasonalConnectedModule =
  | 'PACKAGE_BUILDER'
  | 'DRIP'
  | 'DAM'
  | 'SEO_PLANNER';

export type SeasonalWindowEventType =
  | 'CHECKLIST_TICKED'
  | 'CHECKLIST_UNTICKED'
  | 'NOTES_UPDATED'
  | 'URGENCY_OVERRIDDEN'
  | 'URGENCY_OVERRIDE_CLEARED'
  | 'DISMISSED_FOR_YEAR'
  | 'RESUMED_FROM_DISMISSAL'
  | 'MARKED_READY'
  | 'RETURNED_TO_PLANNING'
  | 'PERMANENTLY_HIDDEN'
  | 'PERMANENTLY_HIDDEN_CLEARED';

/**
 * A single checklist item as seeded in seasonal_calendar_windows.prep_checklist_seed.
 * Labels are rendered live from catalog so seed updates roll forward without migration.
 */
export interface SeasonalChecklistItem {
  key: string;
  label_en: string;
  label_hi: string;
  /** Optional days-before-window-start hint (e.g. T-30, T-7). */
  days_before?: number;
  /** Soft link to another VAiyu module; null/undefined renders as plain text. */
  link_target?: SeasonalConnectedModule | null;
}

/**
 * One row of the v_visible_seasonal_windows view: hotel × catalog × current-season-year state.
 */
export interface VisibleSeasonalWindow {
  hotel_id: string;
  hotel_slug: string;
  hotel_state: string | null;

  window_code: string;
  category: SeasonalCategory;

  display_name_en: string;
  display_name_hi: string;
  why_it_matters_en: string;
  why_it_matters_hi: string;
  recommended_action_en: string;
  recommended_action_hi: string;
  target_guest_segment_en: string | null;
  target_guest_segment_hi: string | null;
  suggested_package_idea_en: string | null;
  suggested_package_idea_hi: string | null;

  start_month: number;
  start_day: number;
  end_month: number;
  end_day: number;
  region_state_codes: string[];
  priority: SeasonalPriority;

  prep_checklist_seed: SeasonalChecklistItem[];
  connected_module_suggestion: SeasonalConnectedModule | null;

  is_approximate: boolean;
  date_disclaimer_en: string | null;
  date_disclaimer_hi: string | null;
  display_order: number;

  /** Computed by view from next_occurrence. */
  season_year: number;
  next_start_ts: string; // ISO timestamptz
  next_end_ts: string;   // ISO timestamptz
  days_to_start: number;

  /** True when window applies to this hotel (or hotel.state is empty → fail-open). */
  is_regional_match: boolean;

  /** State fields — null when no state row exists yet for (hotel, window, year). */
  state_id: string | null;
  review_status: SeasonalReviewStatus;
  ticked_keys: string[];
  owner_notes: string | null;
  internal_notes: string | null;
  urgency_override: SeasonalWindowUrgency | null;
  urgency_override_reason: string | null;
  dismissed_reason: string | null;
  is_permanently_hidden: boolean;
  permanently_hidden_reason: string | null;
  marked_ready_at: string | null;
  marked_ready_by: string | null;

  /** Computed urgency: override if set, else deterministic from dates + now(). */
  computed_urgency: SeasonalWindowUrgency;
  checklist_total: number;
  checklist_done: number;

  state_created_at: string | null;
  state_updated_at: string | null;
  state_updated_by: string | null;
}

/** Append-only event in the per-window timeline. */
export interface SeasonalWindowTimelineEvent {
  id: string;
  event_type: SeasonalWindowEventType;
  payload: Record<string, unknown>;
  actor_id: string | null;
  actor_name: string | null;
  occurred_at: string;
}
