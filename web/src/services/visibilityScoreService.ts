// web/src/services/visibilityScoreService.ts
//
// Typed wrapper around the Visibility Score RPCs + RLS-scoped reads.
//
// RPC error codes are raised as `RAISE EXCEPTION 'CODE'` from PG; we parse
// PostgrestError.message to surface them as typed VisibilityServiceError so
// the UI can render stable copy without string-matching on PG errors.

import { supabase } from '../lib/supabase';
import {
  VisibilityServiceError,
  type HotelVisibilityAttestation,
  type HotelVisibilityScoreRow,
  type VisibilityAttestationState,
  type VisibilityBreakdown,
  type VisibilityCronHealthRow,
  type VisibilityScoreSnapshot,
  type VisibilityServiceErrorCode,
  type VisibilitySignalKey,
  type VisibilitySnapshotTrigger,
} from '../types/visibilityScore';

const KNOWN_CODES = new Set<string>([
  'INVALID_TRIGGER',
  'INVALID_STATE',
  'INVALID_SIGNAL_KEY',
  'CRON_FORBIDDEN',
  'ADMIN_FORBIDDEN',
  'NOT_A_MEMBER',
  'NOT_A_MANAGER',
  'RATE_LIMIT_REFRESH',
  'NOTHING_TO_VERIFY',
  'NOTHING_TO_UNVERIFY',
  'ATTESTATION_LOCKED',
  'EVIDENCE_URL_NOT_ALLOWED',
  'REASON_REQUIRED',
  'USE_MANAGER_VERIFY_RPC',
]);

function toServiceError(err: { message?: string } | null | undefined, fallback: string): never {
  const raw = err?.message ?? '';
  const code = [...KNOWN_CODES].find((c) => raw.includes(c));
  if (code) {
    throw new VisibilityServiceError(code as VisibilityServiceErrorCode, raw);
  }
  throw new VisibilityServiceError('UNKNOWN', raw || fallback);
}

// ── Read: full breakdown for one hotel ───────────────────────────────────────

export async function getVisibilityScore(hotelId: string): Promise<HotelVisibilityScoreRow | null> {
  const { data, error } = await supabase
    .from('v_hotel_visibility_score')
    .select('hotel_id, hotel_slug, hotel_name, breakdown')
    .eq('hotel_id', hotelId)
    .maybeSingle();
  if (error) toServiceError(error, 'Failed to fetch visibility score');
  if (!data) return null;
  return {
    hotel_id: data.hotel_id as string,
    hotel_slug: data.hotel_slug as string,
    hotel_name: data.hotel_name as string,
    breakdown: data.breakdown as VisibilityBreakdown,
  };
}

// ── Read: snapshot history (descending by taken_at) ──────────────────────────

export async function getVisibilityHistory(
  hotelId: string,
  weeks = 12,
): Promise<VisibilityScoreSnapshot[]> {
  const { data, error } = await supabase
    .from('visibility_score_snapshots')
    .select('*')
    .eq('hotel_id_at_snapshot', hotelId)
    .order('taken_at', { ascending: false })
    .limit(weeks);
  if (error) toServiceError(error, 'Failed to fetch visibility history');
  return (data ?? []) as VisibilityScoreSnapshot[];
}

// ── Read: cron health for one hotel ──────────────────────────────────────────

export async function getVisibilityCronHealth(hotelId: string): Promise<VisibilityCronHealthRow | null> {
  const { data, error } = await supabase
    .from('v_visibility_cron_health')
    .select('hotel_id, hotel_slug, last_cron_snapshot_at, healthy')
    .eq('hotel_id', hotelId)
    .maybeSingle();
  if (error) toServiceError(error, 'Failed to fetch cron health');
  return (data as VisibilityCronHealthRow | null) ?? null;
}

// ── Read: attestation rows for one hotel ─────────────────────────────────────

export async function listVisibilityAttestations(hotelId: string): Promise<HotelVisibilityAttestation[]> {
  const { data, error } = await supabase
    .from('hotel_visibility_attestations')
    .select('*')
    .eq('hotel_id', hotelId);
  if (error) toServiceError(error, 'Failed to fetch attestations');
  return (data ?? []) as HotelVisibilityAttestation[];
}

// ── Write: take a snapshot (owner/manager refresh button) ────────────────────

export async function snapshotVisibilityScore(
  hotelId: string,
  trigger: Extract<VisibilitySnapshotTrigger, 'OWNER_REFRESH' | 'MANAGER_REFRESH'>,
): Promise<{ snapshot_id: string; total_score: number; band: string }> {
  const { data, error } = await supabase.rpc('snapshot_visibility_score', {
    p_hotel_id: hotelId,
    p_trigger: trigger,
  });
  if (error) toServiceError(error, 'Failed to snapshot score');
  return data as { snapshot_id: string; total_score: number; band: string };
}

// ── Write: owner self-attest ─────────────────────────────────────────────────

export async function setVisibilityAttestation(
  hotelId: string,
  signalKey: VisibilitySignalKey,
  state: Exclude<VisibilityAttestationState, 'MANAGER_VERIFIED'>,
  evidenceUrl?: string | null,
): Promise<{ id: string; state: VisibilityAttestationState }> {
  const { data, error } = await supabase.rpc('set_visibility_attestation', {
    p_hotel_id: hotelId,
    p_signal_key: signalKey,
    p_state: state,
    p_evidence_url: evidenceUrl ?? null,
  });
  if (error) toServiceError(error, 'Failed to set attestation');
  return data as { id: string; state: VisibilityAttestationState };
}

// ── Write: manager verify ────────────────────────────────────────────────────

export async function managerVerifyAttestation(
  hotelId: string,
  signalKey: VisibilitySignalKey,
  note?: string | null,
): Promise<{ id: string; state: VisibilityAttestationState }> {
  const { data, error } = await supabase.rpc('manager_verify_attestation', {
    p_hotel_id: hotelId,
    p_signal_key: signalKey,
    p_note: note ?? null,
  });
  if (error) toServiceError(error, 'Failed to verify');
  return data as { id: string; state: VisibilityAttestationState };
}

// ── Write: manager unverify (lock rules apply server-side) ───────────────────

export async function managerUnverifyAttestation(
  hotelId: string,
  signalKey: VisibilitySignalKey,
  reason: string,
): Promise<{ id: string; state: VisibilityAttestationState }> {
  const { data, error } = await supabase.rpc('manager_unverify_attestation', {
    p_hotel_id: hotelId,
    p_signal_key: signalKey,
    p_reason: reason,
  });
  if (error) toServiceError(error, 'Failed to unverify');
  return data as { id: string; state: VisibilityAttestationState };
}
