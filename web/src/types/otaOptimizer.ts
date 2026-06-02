// web/src/types/otaOptimizer.ts
//
// TypeScript types mirroring SQL enums + view shapes for OTA Listing
// Optimizer v0. SQL is authoritative; these mirrors are enforced by the
// vitest parity test in otaOptimizer.test.ts.

export type OTAPlatform =
  | 'MMT'
  | 'GOIBIBO'
  | 'BOOKING_COM'
  | 'AGODA'
  | 'AIRBNB'
  | 'EXPEDIA'
  | 'YATRA'
  | 'TRIPADVISOR';

export type OTAReadinessCategory =
  | 'LISTING_QUALITY'
  | 'PHOTOS_MEDIA'
  | 'ROOM_NAMING'
  | 'AMENITIES_FACILITIES'
  | 'POLICIES'
  | 'REVIEW_DISCIPLINE'
  | 'PAYMENT_BOOKING_CLARITY'
  | 'SEASONAL_POSITIONING'
  | 'TRUST_SIGNALS'
  | 'DIRECT_BOOKING_READINESS'
  | 'MOUNTAIN_DISCLOSURE';

export type OTAReadinessStatus =
  | 'COMPLETE'
  | 'PARTIAL'
  | 'MISSING'
  | 'UNKNOWN'
  | 'NOT_APPLICABLE';

export type OTAReadinessBand = 'CRITICAL' | 'MODERATE' | 'PREMIUM';

/** Fix-action deep-link target — only modules with shipped routes. */
export type OTAFixModule =
  | 'DAM'
  | 'PACKAGE_BUILDER'
  | 'SEO_PLANNER'
  | 'SEASONAL_CALENDAR'
  | 'VISIBILITY'
  | 'SETTINGS';

/** TS mirror of one row from _ota_catalog() SQL function. */
export interface OTACatalogItem {
  category: OTAReadinessCategory;
  itemKey: string;
  weight: number;
  isMountainOnly: boolean;
  notApplicableOtas: OTAPlatform[];
  displayOrder: number;
  labelEn: string;
  labelHi: string;
  descEn: string;
  descHi: string;
  fixModule: OTAFixModule;
}

/** Row shape from v_hotel_ota_readiness. */
export interface HotelOTAReadinessRow {
  hotel_id: string;
  hotel_slug: string;
  hotel_name: string;
  ota: OTAPlatform;
  wizard_completed_at: string | null;
  effective_mountain: boolean;
  ota_score: number;
  band: OTAReadinessBand;
  oldest_review_at: string | null;
  complete_count: number;
  partial_count: number;
  missing_count: number;
  unknown_count: number;
  na_count: number;
  stale_count: number;
  total_count: number;
}

/** Row shape from v_hotel_ota_readiness_summary. */
export interface HotelOTAReadinessSummaryRow {
  hotel_id: string;
  hotel_slug: string;
  hotel_name: string;
  wizard_completed_at: string | null;
  effective_mountain: boolean;
  active_ota_count: number;
  overall_score: number;
  overall_band: OTAReadinessBand;
  oldest_review_at: string | null;
  total_gap_count: number;
  total_stale_count: number;
}

/** Row shape from hotel_ota_optimizer_settings table. */
export interface HotelOTASettingsRow {
  hotel_id: string;
  active_otas: OTAPlatform[];
  show_mountain_checks_override: boolean | null;
  wizard_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Row shape from hotel_ota_readiness_state table. */
export interface HotelOTAReadinessStateRow {
  id: string;
  hotel_id: string;
  ota: OTAPlatform;
  category: OTAReadinessCategory;
  item_key: string;
  status: OTAReadinessStatus;
  reviewed_at: string;
  reviewed_by: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** Owner-facing service error codes raised from RPCs as RAISE EXCEPTION. */
export type OTAServiceErrorCode =
  | 'NOT_A_MEMBER'
  | 'OTAS_REQUIRED'
  | 'ITEMS_MUST_BE_ARRAY'
  | 'ITEMS_EMPTY'
  | 'ITEMS_TOO_MANY'
  | 'ITEM_PARSE_ERROR'
  | 'INVALID_ITEM_KEY'
  | 'ITEM_KEY_NOT_IN_CATALOG'
  | 'OTA_NOT_APPLICABLE_FOR_ITEM'
  | 'MOUNTAIN_ITEM_NOT_APPLICABLE'
  | 'NOTE_TOO_LONG'
  | 'NO_STATES_FOR_OTA'
  | 'UNKNOWN_ERROR';

export class OTAServiceError extends Error {
  code: OTAServiceErrorCode;
  constructor(code: OTAServiceErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'OTAServiceError';
  }
}

/** Bulk-set payload row shape (matches jsonb input to bulk_set_ota_readiness). */
export interface OTABulkSetItem {
  ota: OTAPlatform;
  category: OTAReadinessCategory;
  item_key: string;
  status: OTAReadinessStatus;
  note?: string | null;
}
