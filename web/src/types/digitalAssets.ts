// Digital Asset Manager v0 — TypeScript types mirroring the DB schema.
//
// Source: supabase/migrations/20260528000001_digital_asset_manager.sql.
// Keep in sync if the migration evolves.

export type AssetCategory =
  | 'VERIFICATION_PROOF'
  | 'TRUST_ESSENTIALS'
  | 'OPERATIONAL'
  | 'EXPERIENCE';

export type AssetPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type AssetStorageZone = 'PUBLIC_MARKETING' | 'PRIVATE_VAULT';

/**
 * Workflow states. MISSING is computed by the view when no hotel_assets row
 * exists — never stored. COLLECTED is owner-set (or auto on upload). APPROVED
 * + REJECTED are platform_admin only. NEEDS_REPLACEMENT is auto on last-file
 * removal, or can be set by owner.
 */
export type AssetStatus =
  | 'MISSING'
  | 'COLLECTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'NEEDS_REPLACEMENT';

export type AssetCollectedVia = 'OWNER_UPLOAD' | 'AUTO_LINK_BRAND';

/** Single row from v_hotel_asset_status — what the workspace renders. */
export interface AssetStatusRow {
  requirement_code: string;
  category: AssetCategory;
  priority: AssetPriority;
  storage_zone: AssetStorageZone;
  display_name_en: string;
  display_name_hi: string;
  why_it_matters_en: string;
  why_it_matters_hi: string;
  recommended_action_en: string;
  recommended_action_hi: string;
  allow_multiple_files: boolean;
  sort_order: number;
  priority_rank: number;
  category_rank: number;
  hotel_id: string;
  hotel_asset_id: string | null;
  status: AssetStatus;
  collected_via: AssetCollectedVia | null;
  owner_notes: string | null;
  internal_notes: string | null;
  rejection_reason: string | null;
  reviewed_at: string | null;
  review_actor_name: string | null;
  asset_updated_at: string | null;
  file_count: number;
  last_file_at: string | null;
}

/** Single file row attached to a hotel_assets entry. */
export interface AssetFileRow {
  id: string;
  hotel_asset_id: string;
  hotel_id: string;
  bucket: 'hotel-assets' | 'hotel-asset-vault';
  storage_path: string;
  mime_type: string;
  file_size_bytes: number;
  width_px: number | null;
  height_px: number | null;
  alt_text: string | null;
  sort_order: number;
  idempotency_key: string | null;
  uploaded_by_actor_id: string | null;
  uploaded_by_actor_name: string | null;
  created_at: string;
}

/** v_hotel_visible_assets row — reuse hook for Package Builder / Quote PDF / Microsite. */
export interface VisibleAssetRow {
  hotel_id: string;
  requirement_code: string;
  category: AssetCategory;
  storage_zone: AssetStorageZone;
  status: 'COLLECTED' | 'APPROVED';
  file_id: string;
  bucket: 'hotel-assets' | 'hotel-asset-vault';
  storage_path: string;
  mime_type: string;
  alt_text: string | null;
  sort_order: number;
  file_created_at: string;
}

/** Catalog row — system definition of a single asset requirement. */
export interface AssetRequirementRow {
  code: string;
  category: AssetCategory;
  priority: AssetPriority;
  storage_zone: AssetStorageZone;
  display_name_en: string;
  display_name_hi: string;
  why_it_matters_en: string;
  why_it_matters_hi: string;
  recommended_action_en: string;
  recommended_action_hi: string;
  allow_multiple_files: boolean;
  sort_order: number;
  is_active: boolean;
}

/** Aggregated per-category counts for the workspace header. */
export interface CategoryReadinessSummary {
  category: AssetCategory;
  total: number;
  collected: number;
  approved: number;
  missing: number;
  rejected_or_replacement: number;
}

/** Error codes thrown by record_hotel_asset_file + sibling RPCs. */
export type DigitalAssetErrorCode =
  | 'NOT_HOTEL_MEMBER'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'UNKNOWN_REQUIREMENT'
  | 'WRONG_BUCKET_FOR_ZONE'
  | 'STORAGE_PATH_OUTSIDE_HOTEL_FOLDER'
  | 'PII_FILENAME_REJECTED'
  | 'MIME_NOT_ALLOWED'
  | 'FILE_TOO_LARGE'
  | 'NO_FILES_TO_MARK_COLLECTED'
  | 'NO_FILES_TO_APPROVE'
  | 'STATUS_NOT_ALLOWED_FROM_OWNER'
  | 'CANNOT_UNAPPROVE_DIRECTLY'
  | 'PLATFORM_ADMIN_ONLY'
  | 'REJECTION_REASON_REQUIRED'
  | 'ASSET_NOT_FOUND'
  | 'FILE_NOT_FOUND'
  | 'REORDER_LIST_MISMATCH'
  | 'HOTEL_NOT_FOUND';
