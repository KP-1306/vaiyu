// web/src/types/visibilityScore.ts
//
// Types shared across the Visibility Score feature.

export type VisibilityCategory =
  | 'GMB_READINESS'
  | 'TRUST_REPUTATION'
  | 'DIGITAL_ASSETS'
  | 'DIRECT_ENQUIRY'
  | 'EXPERIENCE_PACKAGES';

export type VisibilityBand =
  | 'STRONG'
  | 'GOOD'
  | 'NEEDS_ATTENTION'
  | 'CRITICAL'
  | 'ONBOARDING';

/** SQL: visibility_attestation_state enum. */
export type VisibilityAttestationState =
  | 'UNCLAIMED'
  | 'SELF_ATTESTED'
  | 'MANAGER_VERIFIED';

/** SQL: visibility_snapshot_trigger enum. */
export type VisibilitySnapshotTrigger =
  | 'CRON'
  | 'OWNER_REFRESH'
  | 'MANAGER_REFRESH'
  | 'ADMIN_BACKFILL';

export type VisibilitySignalKind = 'AUTO_DERIVED' | 'SELF_ATTESTED';

/** Stable signal keys — one-to-one with the SQL evaluator branches. */
export type VisibilitySignalKey =
  // GMB_READINESS
  | 'gmb_claimed'
  | 'gmb_verified'
  | 'gmb_category_set'
  | 'address_complete'
  | 'map_pin_set'
  | 'phone_present'
  // TRUST_REPUTATION
  | 'review_link_set'
  | 'reviews_flowing'
  | 'off_platform_response'
  | 'trust_essentials_assets'
  | 'ota_listing_ready'
  | 'gbp_checklist_ready'
  // DIGITAL_ASSETS
  | 'critical_assets_ready'
  | 'high_assets_ready'
  | 'brand_basics'
  | 'guest_info_filled'
  // DIRECT_ENQUIRY
  | 'whatsapp_connected'
  | 'booking_url_set'
  | 'payment_ready'
  | 'lead_response_time'
  // EXPERIENCE_PACKAGES
  | 'package_live'
  | 'seo_blueprint_ready';

/** One row of `_compute_visibility_score(...).signals[]` */
export interface VisibilitySignalDetail {
  key: VisibilitySignalKey;
  category: VisibilityCategory;
  kind: VisibilitySignalKind;
  satisfied: boolean;
  included: boolean;
  state: VisibilityAttestationState | 'AUTO';
  contribution: number;
  max_contribution: number;
  reason: string;
}

/** Shape returned by `_compute_visibility_score(hotel_id)`. */
export interface VisibilityBreakdown {
  version: number;
  total_score: number;
  band: VisibilityBand;
  category_scores: Record<VisibilityCategory, number>;
  signals_satisfied: number;
  signals_total: number;
  signals_excluded: number;
  max_unlockable_weight: number;
  signals: VisibilitySignalDetail[];
}

/** Row from `v_hotel_visibility_score` view. */
export interface HotelVisibilityScoreRow {
  hotel_id: string;
  hotel_slug: string;
  hotel_name: string;
  breakdown: VisibilityBreakdown;
}

/** Row from `visibility_score_snapshots`. */
export interface VisibilityScoreSnapshot {
  id: string;
  hotel_id: string | null;
  hotel_id_at_snapshot: string;
  taken_at: string; // ISO
  formula_version: number;
  total_score: number;
  band: VisibilityBand;
  category_scores: Record<VisibilityCategory, number>;
  signals_satisfied: number;
  signals_total: number;
  signals_excluded: number;
  previous_score: number | null;
  signals_changed: Array<{ key: string; before: string | null; after: string | null }>;
  triggered_by: VisibilitySnapshotTrigger;
  triggered_by_user: string | null;
}

/** Row from `hotel_visibility_attestations`. */
export interface HotelVisibilityAttestation {
  id: string;
  hotel_id: string;
  signal_key: VisibilitySignalKey;
  attestation_schema_version: number;
  state: VisibilityAttestationState;
  evidence_url: string | null;
  attested_by: string | null;
  attested_at: string | null;
  manager_verified_by: string | null;
  manager_verified_at: string | null;
  manager_note: string | null;
  created_at: string;
  updated_at: string;
}

/** Row from `v_visibility_cron_health`. */
export interface VisibilityCronHealthRow {
  hotel_id: string;
  hotel_slug: string;
  last_cron_snapshot_at: string | null;
  healthy: boolean;
}

/** Stable error codes raised by Visibility RPCs. */
export type VisibilityServiceErrorCode =
  | 'INVALID_TRIGGER'
  | 'INVALID_STATE'
  | 'INVALID_SIGNAL_KEY'
  | 'CRON_FORBIDDEN'
  | 'ADMIN_FORBIDDEN'
  | 'NOT_A_MEMBER'
  | 'NOT_A_MANAGER'
  | 'RATE_LIMIT_REFRESH'
  | 'NOTHING_TO_VERIFY'
  | 'NOTHING_TO_UNVERIFY'
  | 'ATTESTATION_LOCKED'
  | 'EVIDENCE_URL_NOT_ALLOWED'
  | 'REASON_REQUIRED'
  | 'USE_MANAGER_VERIFY_RPC'
  | 'UNKNOWN';

export class VisibilityServiceError extends Error {
  code: VisibilityServiceErrorCode;
  constructor(code: VisibilityServiceErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'VisibilityServiceError';
  }
}
