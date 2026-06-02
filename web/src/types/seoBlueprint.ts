// web/src/types/seoBlueprint.ts
//
// Local SEO Landing Planner — types only. Mirrors the DB schema from
// migration 20260529000001_local_seo_landing_planner.sql.

export type SeoBlueprintCategory =
  | 'GEOGRAPHIC_FOCUS'
  | 'TRAVELER_NICHE'
  | 'SEASONAL_POSITION'
  | 'TARGET_MARKET'
  | 'AMENITY_TRUST'
  | 'PACKAGE_LED';

export type SeoBlueprintRisk =
  | 'SAFE_BLUEPRINT'
  | 'NEEDS_PROOF'
  | 'RISKY_DOORWAY'
  | 'FAKE_LOCAL_CLAIM'
  | 'DUPLICATE_LOW_VALUE'
  | 'ON_HOLD';

export type SeoBlueprintStatus =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'READY_TO_BUILD'
  | 'ON_HOLD'
  | 'ARCHIVED';

export type SeoReviewStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'CHANGES_REQUESTED';

export type SeoBlueprintEventType =
  | 'CREATED'
  | 'EDITED'
  | 'RECLASSIFIED'
  | 'SUBMITTED_FOR_REVIEW'
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'HELD'
  | 'RESUMED'
  | 'ARCHIVED'
  | 'SOFT_DELETED';

export interface SeoProofItem {
  key: string;
  label_en: string;
  label_hi: string;
  satisfied: boolean;
}

export interface SeoBlueprint {
  id: string;
  hotel_id: string;

  page_title_concept: string;
  target_category: SeoBlueprintCategory;
  risk_classification: SeoBlueprintRisk;

  status: SeoBlueprintStatus;
  review_status: SeoReviewStatus;

  required_proof: SeoProofItem[];

  why_it_matters: string | null;
  hinglish_guidance: string | null;
  safe_next_action: string | null;
  connected_module_suggestion: string | null;
  owner_notes: string | null;
  internal_notes: string | null;

  review_notes: string | null;
  review_actor_id: string | null;
  reviewed_at: string | null;

  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  deleted_at: string | null;
}

export interface SeoBlueprintEvent {
  id: string;
  blueprint_id: string;
  hotel_id: string;
  event_type: SeoBlueprintEventType;
  payload: Record<string, unknown>;
  actor_id: string | null;
  occurred_at: string;
  event_schema_version: number;
}

export interface SeoBlueprintSummary {
  total: number;
  byRisk: Partial<Record<SeoBlueprintRisk, number>>;
  byStatus: Partial<Record<SeoBlueprintStatus, number>>;
}
