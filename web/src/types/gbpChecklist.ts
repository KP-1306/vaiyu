// web/src/types/gbpChecklist.ts
//
// TypeScript types mirroring SQL enums + view shapes for Google Business
// Checklist v0. SQL is authoritative; vitest parity test in gbpChecklist.test.ts
// enforces match.

import type { VisibilitySignalKey } from './visibilityScore';

export type GBPAttestationState = 'UNCLAIMED' | 'SELF_ATTESTED' | 'MANAGER_VERIFIED';

export type GBPCategory =
  | 'BUSINESS_PROFILE'
  | 'LOCATION_ACCURACY'
  | 'CONTACT_READINESS'
  | 'CONTENT_READINESS'
  | 'TRUST_SIGNALS'
  | 'EXPERIENCE_READINESS'
  | 'VERIFICATION_READINESS';

export type GBPItemKind = 'SELF_ATTESTED' | 'AUTO_DERIVED' | 'LINKED_VISIBILITY';

/** Fix-action target — only modules with shipped routes. */
export type GBPFixModule =
  | 'DAM'
  | 'PACKAGE_BUILDER'
  | 'SEO_PLANNER'
  | 'SEASONAL_CALENDAR'
  | 'VISIBILITY'
  | 'SETTINGS';

/** One row of _gbp_catalog() (SQL authoritative) plus TS-only metadata. */
export interface GBPCatalogItem {
  itemKey: string;
  category: GBPCategory;
  kind: GBPItemKind;
  /** Set only when kind = LINKED_VISIBILITY. */
  linkedVisibilitySignalKey: VisibilitySignalKey | null;
  displayOrder: number;
  // TS-only metadata:
  labelEn: string;
  labelHi: string;
  descEn: string;
  descHi: string;
  fixModule: GBPFixModule;
}

/** Row from gbp_checklist_attestations table. */
export interface GBPAttestationRow {
  id: string;
  hotel_id: string;
  item_key: string;
  attestation_schema_version: number;
  state: GBPAttestationState;
  evidence_url: string | null;
  attested_by: string | null;
  attested_at: string | null;
  manager_verified_by: string | null;
  manager_verified_at: string | null;
  manager_note: string | null;
  created_at: string;
  updated_at: string;
}

/** Row from v_hotel_gbp_readiness view. */
export interface GBPReadinessRow {
  hotel_id: string;
  hotel_slug: string;
  hotel_name: string;
  total_count: number;
  satisfied_count: number;
  overall_score: number;
  most_recent_attestation_at: string | null;
  meets_ready_threshold: boolean;
}

/** Effective per-item status used by the UI (computed client-side). */
export interface GBPItemStatus {
  item: GBPCatalogItem;
  /** Derived attestation state: UNCLAIMED/SELF_ATTESTED/MANAGER_VERIFIED or AUTO-implicit. */
  state: GBPAttestationState | 'AUTO';
  satisfied: boolean;
  /** True for LINKED items when their attestation source is fresh (≤90d). */
  fresh: boolean;
  /** Most recent attestation timestamp (for sorting and stale display). */
  attestedAt: string | null;
  /** True when the row is read-only (AUTO_DERIVED or LINKED_VISIBILITY). */
  readOnly: boolean;
  /** Bookkeeping for LINKED items pointing back to Visibility attestation. */
  linkedVisibilitySignalKey: VisibilitySignalKey | null;
}

/** Owner-facing service error codes. */
export type GBPServiceErrorCode =
  | 'NOT_A_MEMBER'
  | 'NOT_A_MANAGER'
  | 'INVALID_STATE'
  | 'USE_MANAGER_VERIFY_RPC'
  | 'INVALID_ITEM_KEY'
  | 'ITEM_KEY_NOT_IN_CATALOG'
  | 'ITEM_NOT_SELF_ATTESTABLE'
  | 'EVIDENCE_URL_TOO_LONG'
  | 'NOTE_TOO_LONG'
  | 'NOTHING_TO_VERIFY'
  | 'NOTHING_TO_UNVERIFY'
  | 'ATTESTATION_LOCKED'
  | 'REASON_REQUIRED'
  | 'REASON_TOO_LONG'
  | 'UNKNOWN_ERROR';

export class GBPServiceError extends Error {
  code: GBPServiceErrorCode;
  constructor(code: GBPServiceErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'GBPServiceError';
  }
}
