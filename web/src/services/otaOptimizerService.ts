// web/src/services/otaOptimizerService.ts
//
// Typed wrappers around OTA Listing Optimizer RPCs + RLS-scoped reads.
//
// RPC error codes are raised as RAISE EXCEPTION 'CODE' from PG. We parse
// PostgrestError.message and surface them as typed OTAServiceError so the
// UI can render stable copy without string-matching on PG errors.

import { supabase } from '../lib/supabase';
import {
  OTAServiceError,
  type HotelOTAReadinessRow,
  type HotelOTAReadinessSummaryRow,
  type HotelOTAReadinessStateRow,
  type HotelOTASettingsRow,
  type OTABulkSetItem,
  type OTAPlatform,
  type OTAReadinessBand,
  type OTAReadinessCategory,
  type OTAReadinessStatus,
  type OTAServiceErrorCode,
} from '../types/otaOptimizer';

// ── Error mapping ───────────────────────────────────────────────────────────

const KNOWN_CODES: OTAServiceErrorCode[] = [
  'NOT_A_MEMBER',
  'OTAS_REQUIRED',
  'ITEMS_MUST_BE_ARRAY',
  'ITEMS_EMPTY',
  'ITEMS_TOO_MANY',
  'ITEM_PARSE_ERROR',
  'INVALID_ITEM_KEY',
  'ITEM_KEY_NOT_IN_CATALOG',
  'OTA_NOT_APPLICABLE_FOR_ITEM',
  'MOUNTAIN_ITEM_NOT_APPLICABLE',
  'NOTE_TOO_LONG',
  'NO_STATES_FOR_OTA',
];

export function extractOtaErrorCode(err: unknown): OTAServiceErrorCode | null {
  if (!err || typeof err !== 'object' || !('message' in err)) return null;
  const msg = String((err as { message?: string }).message ?? '');
  // Find the FIRST known code that appears as a substring. PG errors often
  // arrive with prefixes like "ERROR: <code>" or wrapped in postgrest-style
  // JSON; a substring scan is more robust than a single regex anchor.
  const code = KNOWN_CODES.find((c) => msg.includes(c));
  return code ?? null;
}

function parseError(err: unknown): OTAServiceError {
  const code = extractOtaErrorCode(err) ?? 'UNKNOWN_ERROR';
  const msg = err && typeof err === 'object' && 'message' in err
    ? String((err as { message?: string }).message ?? '')
    : 'Unknown error';
  return new OTAServiceError(code, msg);
}

export function friendlyOtaError(code: OTAServiceErrorCode | null, fallback: string): string {
  switch (code) {
    case 'NOT_A_MEMBER':
      return 'You do not have permission for this action. Ask the hotel owner or manager.';
    case 'OTAS_REQUIRED':
      return 'Select at least one OTA to keep active.';
    case 'ITEMS_MUST_BE_ARRAY':
      return 'Bulk update payload is malformed. Refresh the page.';
    case 'ITEMS_EMPTY':
      return 'No items to update.';
    case 'ITEMS_TOO_MANY':
      return 'Too many items in one update (max 200). Split into smaller batches.';
    case 'ITEM_PARSE_ERROR':
      return 'One of the items has an invalid OTA, category, or status value.';
    case 'INVALID_ITEM_KEY':
      return 'An item key is empty or too long. Refresh the page.';
    case 'ITEM_KEY_NOT_IN_CATALOG':
      return 'This checklist item no longer exists. Refresh the page.';
    case 'OTA_NOT_APPLICABLE_FOR_ITEM':
      return 'This item does not apply to the selected OTA.';
    case 'MOUNTAIN_ITEM_NOT_APPLICABLE':
      return 'Mountain disclosures don\'t apply to this property. Flip the mountain-checks override if you want to track them.';
    case 'NOTE_TOO_LONG':
      return 'Notes must be under 2000 characters.';
    case 'NO_STATES_FOR_OTA':
      return 'No items have been reviewed for this OTA yet — set a few statuses first.';
    case 'UNKNOWN_ERROR':
    case null:
    default:
      return fallback;
  }
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function getOtaReadinessByOta(hotelId: string): Promise<HotelOTAReadinessRow[]> {
  const { data, error } = await supabase
    .from('v_hotel_ota_readiness')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('ota', { ascending: true });
  if (error) throw parseError(error);
  return (data ?? []) as HotelOTAReadinessRow[];
}

export async function getOtaReadinessSummary(hotelId: string): Promise<HotelOTAReadinessSummaryRow | null> {
  const { data, error } = await supabase
    .from('v_hotel_ota_readiness_summary')
    .select('*')
    .eq('hotel_id', hotelId)
    .maybeSingle();
  if (error) throw parseError(error);
  return (data as HotelOTAReadinessSummaryRow | null) ?? null;
}

export async function getOtaSettings(hotelId: string): Promise<HotelOTASettingsRow | null> {
  const { data, error } = await supabase
    .from('hotel_ota_optimizer_settings')
    .select('*')
    .eq('hotel_id', hotelId)
    .maybeSingle();
  if (error) throw parseError(error);
  return (data as HotelOTASettingsRow | null) ?? null;
}

export async function listOtaReadinessState(hotelId: string): Promise<HotelOTAReadinessStateRow[]> {
  const { data, error } = await supabase
    .from('hotel_ota_readiness_state')
    .select('*')
    .eq('hotel_id', hotelId);
  if (error) throw parseError(error);
  return (data ?? []) as HotelOTAReadinessStateRow[];
}

// ── Writes ─────────────────────────────────────────────────────────────────

export async function setOtaActiveOtas(hotelId: string, otas: OTAPlatform[]): Promise<{ active_otas: OTAPlatform[] }> {
  const { data, error } = await supabase.rpc('set_ota_active_otas', {
    p_hotel_id: hotelId,
    p_otas: otas,
  });
  if (error) throw parseError(error);
  return data as { active_otas: OTAPlatform[] };
}

export async function setOtaMountainOverride(
  hotelId: string,
  override: boolean | null,
): Promise<{ override: boolean | null; effective_mountain: boolean }> {
  const { data, error } = await supabase.rpc('set_ota_mountain_override', {
    p_hotel_id: hotelId,
    p_override: override,
  });
  if (error) throw parseError(error);
  return data as { override: boolean | null; effective_mountain: boolean };
}

export async function setOtaReadinessStatus(input: {
  hotelId: string;
  ota: OTAPlatform;
  category: OTAReadinessCategory;
  itemKey: string;
  status: OTAReadinessStatus;
  note?: string | null;
}): Promise<{ state_id: string; status: OTAReadinessStatus; reviewed_at: string }> {
  const { data, error } = await supabase.rpc('set_ota_readiness_status', {
    p_hotel_id: input.hotelId,
    p_ota: input.ota,
    p_category: input.category,
    p_item_key: input.itemKey,
    p_status: input.status,
    p_note: input.note ?? null,
  });
  if (error) throw parseError(error);
  return data as { state_id: string; status: OTAReadinessStatus; reviewed_at: string };
}

export async function bulkSetOtaReadiness(
  hotelId: string,
  items: OTABulkSetItem[],
): Promise<{ count: number; inserted: number; updated: number }> {
  const { data, error } = await supabase.rpc('bulk_set_ota_readiness', {
    p_hotel_id: hotelId,
    p_items: items,
  });
  if (error) throw parseError(error);
  return data as { count: number; inserted: number; updated: number };
}

export async function markOtaReviewComplete(
  hotelId: string,
  ota: OTAPlatform,
): Promise<{ ota: OTAPlatform; items_refreshed: number }> {
  const { data, error } = await supabase.rpc('mark_ota_review_complete', {
    p_hotel_id: hotelId,
    p_ota: ota,
  });
  if (error) throw parseError(error);
  return data as { ota: OTAPlatform; items_refreshed: number };
}

export async function completeOtaWizard(hotelId: string): Promise<{ wizard_completed_at: string; changed: boolean }> {
  const { data, error } = await supabase.rpc('complete_ota_wizard', {
    p_hotel_id: hotelId,
  });
  if (error) throw parseError(error);
  return data as { wizard_completed_at: string; changed: boolean };
}

export async function resetOtaReadiness(
  hotelId: string,
  ota?: OTAPlatform,
): Promise<{ items_deleted: number; ota: OTAPlatform | null }> {
  const { data, error } = await supabase.rpc('reset_ota_readiness', {
    p_hotel_id: hotelId,
    p_ota: ota ?? null,
  });
  if (error) throw parseError(error);
  return data as { items_deleted: number; ota: OTAPlatform | null };
}

// ── Client-side computed summaries ─────────────────────────────────────────

const BAND_RANK: Record<OTAReadinessBand, number> = {
  CRITICAL: 0,
  MODERATE: 1,
  PREMIUM:  2,
};

export interface OtaDashboardSummary {
  overallScore: number;
  overallBand: OTAReadinessBand;
  activeOtaCount: number;
  totalGapCount: number;
  totalStaleCount: number;
  /** Per-OTA rows sorted by band ascending (worst first). */
  perOta: HotelOTAReadinessRow[];
  /** Single OTA needing the most attention (lowest band, then lowest score). */
  focusOta: HotelOTAReadinessRow | null;
  wizardCompletedAt: string | null;
  effectiveMountain: boolean;
}

export function summarizeOtaReadiness(
  summary: HotelOTAReadinessSummaryRow | null,
  perOta: HotelOTAReadinessRow[],
): OtaDashboardSummary | null {
  if (!summary) {
    if (perOta.length === 0) return null;
    // Fall back to computing summary from per-OTA rows if summary view missing.
    const avg = perOta.reduce((acc, r) => acc + r.ota_score, 0) / perOta.length;
    const score = Math.round(avg * 10) / 10;
    const band: OTAReadinessBand = score >= 80 ? 'PREMIUM' : score >= 50 ? 'MODERATE' : 'CRITICAL';
    return {
      overallScore: score,
      overallBand: band,
      activeOtaCount: perOta.length,
      totalGapCount: perOta.reduce((a, r) => a + r.missing_count + r.unknown_count, 0),
      totalStaleCount: perOta.reduce((a, r) => a + r.stale_count, 0),
      perOta: [...perOta].sort(byBandThenScore),
      focusOta: pickFocusOta(perOta),
      wizardCompletedAt: perOta[0]?.wizard_completed_at ?? null,
      effectiveMountain: perOta[0]?.effective_mountain ?? false,
    };
  }
  return {
    overallScore: summary.overall_score,
    overallBand: summary.overall_band,
    activeOtaCount: summary.active_ota_count,
    totalGapCount: summary.total_gap_count,
    totalStaleCount: summary.total_stale_count,
    perOta: [...perOta].sort(byBandThenScore),
    focusOta: pickFocusOta(perOta),
    wizardCompletedAt: summary.wizard_completed_at,
    effectiveMountain: summary.effective_mountain,
  };
}

function byBandThenScore(a: HotelOTAReadinessRow, b: HotelOTAReadinessRow): number {
  const dr = BAND_RANK[a.band] - BAND_RANK[b.band];
  if (dr !== 0) return dr;
  return a.ota_score - b.ota_score;
}

function pickFocusOta(perOta: HotelOTAReadinessRow[]): HotelOTAReadinessRow | null {
  if (perOta.length === 0) return null;
  const sorted = [...perOta].sort(byBandThenScore);
  return sorted[0];
}
