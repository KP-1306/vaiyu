// web/src/services/seasonalCalendarService.ts
//
// Seasonal Demand Calendar v0 — typed wrappers around the RPCs + the
// security_invoker view (v_visible_seasonal_windows).
//
// All writes go through SECURITY DEFINER RPCs. Reads pull from the view so
// the same render path is used by dashboard card and full workspace.

import { supabase } from '../lib/supabase';
import type {
  SeasonalReviewStatus,
  SeasonalWindowEventType,
  SeasonalWindowTimelineEvent,
  SeasonalWindowUrgency,
  VisibleSeasonalWindow,
} from '../types/seasonalCalendar';

// ── Error mapping ───────────────────────────────────────────────────────────

export type SeasonalServiceErrorCode =
  | 'NOT_AUTHORIZED'
  | 'WINDOW_NOT_FOUND'
  | 'STATE_NOT_FOUND'
  | 'ITEM_KEY_REQUIRED'
  | 'ITEM_KEY_NOT_IN_CATALOG'
  | 'OVERRIDE_REASON_REQUIRED'
  | 'DISMISS_REASON_REQUIRED'
  | 'HIDE_REASON_REQUIRED'
  | 'INVALID_TRANSITION'
  | 'UNKNOWN_ERROR';

export class SeasonalServiceError extends Error {
  code: SeasonalServiceErrorCode;
  constructor(code: SeasonalServiceErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'SeasonalServiceError';
  }
}

const KNOWN_CODES: SeasonalServiceErrorCode[] = [
  'NOT_AUTHORIZED',
  'WINDOW_NOT_FOUND',
  'STATE_NOT_FOUND',
  'ITEM_KEY_REQUIRED',
  'ITEM_KEY_NOT_IN_CATALOG',
  'OVERRIDE_REASON_REQUIRED',
  'DISMISS_REASON_REQUIRED',
  'HIDE_REASON_REQUIRED',
  'INVALID_TRANSITION',
];

export function extractSeasonalErrorCode(err: unknown): SeasonalServiceErrorCode | null {
  if (!err || typeof err !== 'object' || !('message' in err)) return null;
  const msg = String((err as { message?: string }).message ?? '');
  const m = msg.match(/\b([A-Z][A-Z0-9_]+)\b/);
  if (!m || !m[1]) return null;
  return (KNOWN_CODES as string[]).includes(m[1]) ? (m[1] as SeasonalServiceErrorCode) : null;
}

function parseError(err: unknown): SeasonalServiceError {
  const code = extractSeasonalErrorCode(err) ?? 'UNKNOWN_ERROR';
  const msg = err && typeof err === 'object' && 'message' in err
    ? String((err as { message?: string }).message ?? '')
    : 'Unknown error';
  return new SeasonalServiceError(code, msg);
}

export function friendlySeasonalError(code: SeasonalServiceErrorCode | null, fallback: string): string {
  switch (code) {
    case 'NOT_AUTHORIZED':
      return 'You do not have permission for this action. Ask the hotel owner or manager to do it.';
    case 'WINDOW_NOT_FOUND':
      return 'This planning window is no longer available. Refresh the page.';
    case 'STATE_NOT_FOUND':
      return 'No state to update yet — try ticking a checklist item or adding a note first.';
    case 'ITEM_KEY_REQUIRED':
      return 'Pick a checklist item first.';
    case 'ITEM_KEY_NOT_IN_CATALOG':
      return 'This checklist item no longer exists. Refresh the page.';
    case 'OVERRIDE_REASON_REQUIRED':
      return 'Add a short reason for overriding the urgency.';
    case 'DISMISS_REASON_REQUIRED':
      return 'Add a short reason for dismissing this window.';
    case 'HIDE_REASON_REQUIRED':
      return 'Add a short reason for permanently hiding this window.';
    case 'INVALID_TRANSITION':
      return 'That action is not valid in the current state.';
    case 'UNKNOWN_ERROR':
    case null:
    default:
      return fallback;
  }
}

// ── Reads ───────────────────────────────────────────────────────────────────

export interface ListVisibleWindowsOptions {
  /** When true, includes is_permanently_hidden=true rows (defaults to false). */
  includeHidden?: boolean;
  /** When true, includes DISMISSED windows (defaults to true — shown in a separate UI tab). */
  includeDismissed?: boolean;
}

export async function listVisibleSeasonalWindows(
  hotelId: string,
  options: ListVisibleWindowsOptions = {},
): Promise<VisibleSeasonalWindow[]> {
  let q = supabase
    .from('v_visible_seasonal_windows')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('display_order', { ascending: true });
  if (!options.includeHidden) q = q.eq('is_permanently_hidden', false);
  const { data, error } = await q;
  if (error) throw parseError(error);
  const rows = (data ?? []) as VisibleSeasonalWindow[];
  if (options.includeDismissed === false) {
    return rows.filter((r) => r.review_status !== 'DISMISSED');
  }
  return rows;
}

export async function getSeasonalWindowTimeline(
  hotelId: string,
  windowCode: string,
  seasonYear: number,
  limit = 20,
): Promise<SeasonalWindowTimelineEvent[]> {
  const { data, error } = await supabase.rpc('get_seasonal_window_timeline', {
    p_hotel_id: hotelId,
    p_window_code: windowCode,
    p_season_year: seasonYear,
    p_limit: limit,
  });
  if (error) throw parseError(error);
  return (data ?? []) as SeasonalWindowTimelineEvent[];
}

// ── Summary (computed client-side from the view) ────────────────────────────

export interface SeasonalCalendarSummary {
  total: number;
  byUrgency: Partial<Record<SeasonalWindowUrgency, number>>;
  byReviewStatus: Partial<Record<SeasonalReviewStatus, number>>;
  /** Window with highest urgency for the dashboard card "next focus" line. */
  topWindow: VisibleSeasonalWindow | null;
}

const URGENCY_RANK: Record<SeasonalWindowUrgency, number> = {
  NOW: 0,
  PREPARE: 1,
  WATCH: 2,
  QUIET: 3,
};

export function summarizeSeasonalCalendar(
  windows: VisibleSeasonalWindow[],
): SeasonalCalendarSummary {
  const byUrgency: Partial<Record<SeasonalWindowUrgency, number>> = {};
  const byReviewStatus: Partial<Record<SeasonalReviewStatus, number>> = {};
  const visible = windows.filter((w) => !w.is_permanently_hidden && w.review_status !== 'DISMISSED');
  let topWindow: VisibleSeasonalWindow | null = null;
  let topRank = Infinity;
  let topDays = Infinity;
  for (const w of visible) {
    byUrgency[w.computed_urgency] = (byUrgency[w.computed_urgency] ?? 0) + 1;
    byReviewStatus[w.review_status] = (byReviewStatus[w.review_status] ?? 0) + 1;
    const rank = URGENCY_RANK[w.computed_urgency];
    if (rank < topRank || (rank === topRank && w.days_to_start < topDays)) {
      topRank = rank;
      topDays = w.days_to_start;
      topWindow = w;
    }
  }
  // Also count dismissed rows for the "Dismissed" badge in the workspace.
  for (const w of windows.filter((x) => x.review_status === 'DISMISSED' && !x.is_permanently_hidden)) {
    byReviewStatus['DISMISSED'] = (byReviewStatus['DISMISSED'] ?? 0) + 1;
  }
  return { total: visible.length, byUrgency, byReviewStatus, topWindow };
}

// ── Writes — checklist + notes (any member) ─────────────────────────────────

export interface TickChecklistResult {
  stateId: string;
  changed: boolean;
  tickedKeys: string[];
  seasonYear?: number;
}

export async function tickSeasonalChecklist(input: {
  hotelId: string;
  windowCode: string;
  itemKey: string;
  ticked: boolean;
}): Promise<TickChecklistResult> {
  const { data, error } = await supabase.rpc('tick_seasonal_checklist', {
    p_hotel_id: input.hotelId,
    p_window_code: input.windowCode,
    p_item_key: input.itemKey,
    p_ticked: input.ticked,
  });
  if (error) throw parseError(error);
  const obj = (data ?? {}) as {
    state_id?: string;
    changed?: boolean;
    ticked_keys?: string[];
    season_year?: number;
  };
  return {
    stateId: obj.state_id ?? '',
    changed: Boolean(obj.changed),
    tickedKeys: Array.isArray(obj.ticked_keys) ? obj.ticked_keys : [],
    seasonYear: obj.season_year,
  };
}

export interface UpdateNotesResult {
  stateId: string;
  changed: boolean;
  ownerNotes: string | null;
  internalNotes: string | null;
}

export async function updateSeasonalWindowNotes(input: {
  hotelId: string;
  windowCode: string;
  ownerNotes?: string | null;
  internalNotes?: string | null;
}): Promise<UpdateNotesResult> {
  const { data, error } = await supabase.rpc('update_seasonal_window_notes', {
    p_hotel_id: input.hotelId,
    p_window_code: input.windowCode,
    p_owner_notes: input.ownerNotes ?? null,
    p_internal_notes: input.internalNotes ?? null,
  });
  if (error) throw parseError(error);
  const obj = (data ?? {}) as {
    state_id?: string;
    changed?: boolean;
    owner_notes?: string | null;
    internal_notes?: string | null;
  };
  return {
    stateId: obj.state_id ?? '',
    changed: Boolean(obj.changed),
    ownerNotes: obj.owner_notes ?? null,
    internalNotes: obj.internal_notes ?? null,
  };
}

// ── Writes — governance (manager+) ──────────────────────────────────────────

export async function overrideSeasonalWindowUrgency(input: {
  hotelId: string;
  windowCode: string;
  urgency: SeasonalWindowUrgency | null; // null = clear
  reason?: string;
}): Promise<void> {
  const { error } = await supabase.rpc('override_seasonal_window_urgency', {
    p_hotel_id: input.hotelId,
    p_window_code: input.windowCode,
    p_urgency: input.urgency,
    p_reason: input.reason ?? null,
  });
  if (error) throw parseError(error);
}

export async function dismissSeasonalWindowForYear(input: {
  hotelId: string;
  windowCode: string;
  reason: string;
}): Promise<void> {
  const { error } = await supabase.rpc('dismiss_seasonal_window_for_year', {
    p_hotel_id: input.hotelId,
    p_window_code: input.windowCode,
    p_reason: input.reason,
  });
  if (error) throw parseError(error);
}

export async function resumeSeasonalWindow(input: {
  hotelId: string;
  windowCode: string;
}): Promise<void> {
  const { error } = await supabase.rpc('resume_seasonal_window', {
    p_hotel_id: input.hotelId,
    p_window_code: input.windowCode,
  });
  if (error) throw parseError(error);
}

export async function markSeasonalWindowReady(input: {
  hotelId: string;
  windowCode: string;
}): Promise<void> {
  const { error } = await supabase.rpc('mark_seasonal_window_ready', {
    p_hotel_id: input.hotelId,
    p_window_code: input.windowCode,
  });
  if (error) throw parseError(error);
}

export async function returnSeasonalWindowToPlanning(input: {
  hotelId: string;
  windowCode: string;
}): Promise<void> {
  const { error } = await supabase.rpc('return_seasonal_window_to_planning', {
    p_hotel_id: input.hotelId,
    p_window_code: input.windowCode,
  });
  if (error) throw parseError(error);
}

export async function setSeasonalWindowPermanentlyHidden(input: {
  hotelId: string;
  windowCode: string;
  hidden: boolean;
  reason?: string;
}): Promise<void> {
  const { error } = await supabase.rpc('set_seasonal_window_permanently_hidden', {
    p_hotel_id: input.hotelId,
    p_window_code: input.windowCode,
    p_hidden: input.hidden,
    p_reason: input.reason ?? null,
  });
  if (error) throw parseError(error);
}

// ── Event-type labels for inline timeline rendering ─────────────────────────

export const SEASONAL_EVENT_LABEL: Record<SeasonalWindowEventType, string> = {
  CHECKLIST_TICKED:           'Ticked checklist item',
  CHECKLIST_UNTICKED:         'Unticked checklist item',
  NOTES_UPDATED:              'Updated notes',
  URGENCY_OVERRIDDEN:         'Overrode urgency',
  URGENCY_OVERRIDE_CLEARED:   'Cleared urgency override',
  DISMISSED_FOR_YEAR:         'Dismissed for the year',
  RESUMED_FROM_DISMISSAL:     'Resumed from dismissal',
  MARKED_READY:               'Marked READY',
  RETURNED_TO_PLANNING:       'Returned to planning',
  PERMANENTLY_HIDDEN:         'Permanently hidden',
  PERMANENTLY_HIDDEN_CLEARED: 'Permanent hide cleared',
};
