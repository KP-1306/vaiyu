// web/src/types/package.ts
//
// Experience Package Builder — types only.

export type PackageCategory =
  | 'WEEKEND_ESCAPE'
  | 'ADVENTURE_TREKKING'
  | 'RELIGIOUS_SPIRITUAL'
  | 'WELLNESS_YOGA'
  | 'WORKATION_MONSOON'
  | 'FAMILY_STAY'
  | 'COUPLE_RETREAT'
  | 'CUSTOM';

export type PackageStatus =
  | 'DRAFT'
  | 'READY'
  | 'ACTIVE'
  | 'PAUSED'
  | 'ARCHIVED';

export type PackageApprovalStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'CHANGES_REQUESTED';

export type PackagePricingBasis =
  | 'PER_ROOM_PER_NIGHT'
  | 'PER_PERSON_PER_NIGHT'
  | 'PER_PACKAGE';

export type PackageEventType =
  | 'CREATED'
  | 'EDITED'
  | 'DUPLICATED'
  | 'SUBMITTED_FOR_APPROVAL'
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'PUBLISHED'
  | 'PAUSED'
  | 'RESUMED'
  | 'ARCHIVED'
  | 'SOFT_DELETED';

export interface Package {
  id: string;
  hotel_id: string;
  slug: string;

  name: string;
  category: PackageCategory;
  target_guest_type: string | null;
  hero_image_url: string | null;
  short_pitch: string | null;
  long_description: string | null;

  duration_nights: number;
  min_party_adults: number;
  max_party_adults: number | null;
  room_type_id: string | null;

  season_months: number[];
  valid_from: string | null;
  valid_until: string | null;

  food_inclusions: string[];
  activity_inclusions: string[];
  transfer_inclusions: string[];
  custom_inclusions: string[];

  base_price_paise: number | null;
  base_price_basis: PackagePricingBasis;
  starting_price_text: string;

  enquiry_cta_label: string;

  status: PackageStatus;
  owner_approval_status: PackageApprovalStatus;
  approval_notes: string | null;
  internal_notes: string | null;

  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  published_at: string | null;
  paused_at: string | null;
  deleted_at: string | null;
}

export interface PackageEvent {
  id: string;
  package_id: string;
  hotel_id: string;
  event_type: PackageEventType;
  payload: Record<string, unknown>;
  actor_id: string | null;
  occurred_at: string;
  event_schema_version: number;
}

/** Subset returned by the anon `get_package_public` RPC. */
export interface PublicPackagePayload {
  package: {
    id: string;
    slug: string;
    name: string;
    category: PackageCategory;
    target_guest_type: string | null;
    hero_image_url: string | null;
    short_pitch: string | null;
    long_description: string | null;
    duration_nights: number;
    min_party_adults: number;
    max_party_adults: number | null;
    season_months: number[];
    valid_from: string | null;
    valid_until: string | null;
    food_inclusions: string[];
    activity_inclusions: string[];
    transfer_inclusions: string[];
    custom_inclusions: string[];
    starting_price_text: string;
    enquiry_cta_label: string;
  };
  hotel: {
    id: string;
    name: string;
    city: string | null;
    slug: string;
  };
}
