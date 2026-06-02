// web/src/types/partner.ts
//
// Partner Network — types only. Position 4 of the growth sheet.
// Mirrors migration 20260526000007_partner_network.sql.

export type PartnerKind = 'VENDOR' | 'AGENT';

/** AGENT-flavoured categories. */
export const PARTNER_AGENT_CATEGORIES = [
  'TRAVEL_AGENT',
  'CORPORATE_BOOKER',
  'WEDDING_PLANNER',
  'GROUP_BOOKER',
  'OTHER',
] as const;

/** VENDOR-flavoured categories. */
export const PARTNER_VENDOR_CATEGORIES = [
  'TAXI_TRANSPORT',
  'TREK_GUIDE',
  'TEMPLE_TOUR',
  'SAFARI_ADVENTURE',
  'PHOTOGRAPHER',
  'EVENT_DECORATION',
  'WELLNESS_YOGA',
  'FOOD_CATERING',
  'LAUNDRY_OPS',
  'MAINTENANCE_VENDOR',
  'OTHER',
] as const;

export type PartnerAgentCategory = typeof PARTNER_AGENT_CATEGORIES[number];
export type PartnerVendorCategory = typeof PARTNER_VENDOR_CATEGORIES[number];
export type PartnerCategory = PartnerAgentCategory | PartnerVendorCategory;

export type PartnerStatus =
  | 'DRAFT'
  | 'VERIFIED'
  | 'PREFERRED'
  | 'BACKUP'
  | 'INACTIVE'
  | 'DO_NOT_USE';

export type PartnerVerificationStatus =
  | 'UNVERIFIED'
  | 'PENDING'
  | 'VERIFIED'
  | 'REJECTED';

export type PartnerCommissionStatus = 'ACCRUED' | 'PAID' | 'CANCELLED';

export type PartnerEventType =
  | 'CREATED'
  | 'UPDATED'
  | 'STATUS_CHANGED'
  | 'VERIFICATION_CHANGED'
  | 'ARCHIVED'
  | 'UNARCHIVED'
  | 'COMMISSION_RECORDED'
  | 'COMMISSION_PAID'
  | 'COMMISSION_CANCELLED'
  | 'LINKED_TO_LEAD';

export interface Partner {
  id: string;
  hotel_id: string;
  kind: PartnerKind;
  category: PartnerCategory;
  partner_name: string;
  service_area: string;
  services_offered: string[];
  preferred_use_case: string;
  price_note_text: string;
  emergency_availability: boolean;

  status: PartnerStatus;
  verification_status: PartnerVerificationStatus;
  verification_notes: string;
  last_verified_at: string | null;
  last_verified_by: string | null;

  contact_name: string;
  contact_phone: string | null;
  alternate_contact: string | null;
  email: string | null;

  // AGENT-only (NULL on VENDOR)
  commission_pct: number | null;
  payout_terms: string | null;

  notes: string;
  tags: string[];
  metadata: Record<string, unknown>;

  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;

  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

/** Row from v_partner_directory view — partners + derived signals. */
export interface PartnerDirectoryRow extends Partner {
  is_archived: boolean;
  is_verification_stale: boolean;   // VERIFIED + last_verified_at > 90d ago
  lead_count: number;
  commission_outstanding_inr: number;
  commission_paid_inr: number;
}

export interface PartnerEvent {
  id: string;
  partner_id: string;
  hotel_id: string;
  event_type: PartnerEventType;
  payload: Record<string, unknown>;
  actor_id: string | null;
  occurred_at: string;
  event_schema_version: number;
}

export interface PartnerCommission {
  id: string;
  hotel_id: string;
  partner_id: string;
  lead_id: string | null;
  booking_id: string | null;
  amount_inr: number;
  status: PartnerCommissionStatus;
  accrued_at: string;
  marked_paid_at: string | null;
  marked_paid_by: string | null;
  payout_reference: string | null;
  payout_method: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancelled_reason: string | null;
  notes: string;
  idempotency_key: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Per-category display labels (UI-facing). */
export const PARTNER_CATEGORY_LABEL: Record<PartnerCategory, string> = {
  TRAVEL_AGENT: 'Travel agent',
  CORPORATE_BOOKER: 'Corporate booker',
  WEDDING_PLANNER: 'Wedding planner',
  GROUP_BOOKER: 'Group booker',
  TAXI_TRANSPORT: 'Taxi / transport',
  TREK_GUIDE: 'Trek guide',
  TEMPLE_TOUR: 'Temple / pilgrim tour',
  SAFARI_ADVENTURE: 'Safari / adventure',
  PHOTOGRAPHER: 'Photographer',
  EVENT_DECORATION: 'Event / decoration',
  WELLNESS_YOGA: 'Wellness / yoga',
  FOOD_CATERING: 'Food / catering',
  LAUNDRY_OPS: 'Laundry / ops',
  MAINTENANCE_VENDOR: 'Maintenance vendor',
  OTHER: 'Other',
};

export const PARTNER_STATUS_LABEL: Record<PartnerStatus, string> = {
  DRAFT: 'Draft',
  VERIFIED: 'Verified',
  PREFERRED: 'Preferred',
  BACKUP: 'Backup',
  INACTIVE: 'Inactive',
  DO_NOT_USE: 'Do not use',
};

export const PARTNER_VERIFICATION_LABEL: Record<PartnerVerificationStatus, string> = {
  UNVERIFIED: 'Not verified',
  PENDING: 'Verification pending',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
};

/** Tone tokens for status pills (consumed by UI styling). */
export const PARTNER_STATUS_TONE: Record<PartnerStatus, 'neutral' | 'green' | 'gold' | 'amber' | 'grey' | 'red'> = {
  DRAFT: 'neutral',
  VERIFIED: 'green',
  PREFERRED: 'gold',
  BACKUP: 'amber',
  INACTIVE: 'grey',
  DO_NOT_USE: 'red',
};

export function categoriesForKind(kind: PartnerKind): readonly PartnerCategory[] {
  return kind === 'AGENT' ? PARTNER_AGENT_CATEGORIES : PARTNER_VENDOR_CATEGORIES;
}

/** Disclaimer copy (English + Hindi) for the partner directory footer. */
export const PARTNER_LIABILITY_DISCLAIMER_EN =
  'This is an internal partner directory. Rates, availability, licensing, insurance, safety, and service quality must be independently verified by the property team. VAiyu does not assume vendor liability.';

export const PARTNER_LIABILITY_DISCLAIMER_HI =
  'Yeh internal partner list hai. Guest ko recommend karne se pehle partner ka phone, rate aur availability manually verify karein.';
