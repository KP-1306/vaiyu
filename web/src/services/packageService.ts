// web/src/services/packageService.ts
//
// Typed wrapper around the package_* RPCs + RLS-scoped reads.

import { supabase } from '../lib/supabase';
import type {
  Package,
  PackageApprovalStatus,
  PackageCategory,
  PackageEvent,
  PackagePricingBasis,
  PackageStatus,
  PublicPackagePayload,
} from '../types/package';

export type PackageServiceErrorCode =
  | 'NOT_AUTHORIZED'
  | 'PACKAGE_NOT_FOUND'
  | 'PACKAGE_DELETED'
  | 'NOT_EDITABLE'
  | 'INVALID_TRANSITION'
  | 'APPROVAL_REQUIRED'
  | 'NOTE_REQUIRED'
  | 'SLUG_TAKEN'
  | 'ROOM_TYPE_MISMATCH'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'UNKNOWN_ERROR';

export class PackageServiceError extends Error {
  code: PackageServiceErrorCode;
  constructor(code: PackageServiceErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'PackageServiceError';
  }
}

const KNOWN_CODES: PackageServiceErrorCode[] = [
  'NOT_AUTHORIZED', 'PACKAGE_NOT_FOUND', 'PACKAGE_DELETED', 'NOT_EDITABLE',
  'INVALID_TRANSITION', 'APPROVAL_REQUIRED', 'NOTE_REQUIRED', 'SLUG_TAKEN',
  'ROOM_TYPE_MISMATCH', 'INVALID_REQUEST', 'NOT_FOUND',
];

function parseError(err: unknown): PackageServiceError {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = String((err as { message?: string }).message ?? '');
    const m = msg.match(/^([A-Z][A-Z0-9_]*)/);
    if (m && m[1] && (KNOWN_CODES as string[]).includes(m[1])) {
      return new PackageServiceError(m[1] as PackageServiceErrorCode, msg);
    }
    return new PackageServiceError('UNKNOWN_ERROR', msg);
  }
  return new PackageServiceError('UNKNOWN_ERROR', 'Unknown error');
}

// ─── Reads ─────────────────────────────────────────────────────────────────

export interface ListPackagesOptions {
  includeArchived?: boolean;
  includeDeleted?: boolean;
  categories?: PackageCategory[];
  statuses?: PackageStatus[];
  approvalStatuses?: PackageApprovalStatus[];
  search?: string;
  limit?: number;
}

export async function listPackages(
  hotelId: string,
  options: ListPackagesOptions = {},
): Promise<Package[]> {
  let q = supabase
    .from('packages')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('updated_at', { ascending: false })
    .limit(options.limit ?? 100);
  if (!options.includeDeleted) q = q.is('deleted_at', null);
  if (!options.includeArchived) q = q.neq('status', 'ARCHIVED');
  if (options.categories?.length) q = q.in('category', options.categories);
  if (options.statuses?.length) q = q.in('status', options.statuses);
  if (options.approvalStatuses?.length) q = q.in('owner_approval_status', options.approvalStatuses);
  if (options.search) {
    const term = `%${options.search}%`;
    q = q.or(`name.ilike.${term},short_pitch.ilike.${term},target_guest_type.ilike.${term}`);
  }
  const { data, error } = await q;
  if (error) throw parseError(error);
  return (data ?? []) as Package[];
}

/** Convenience: only ACTIVE+APPROVED packages, for the Quote Drafts picker. */
export async function listActivePackages(hotelId: string): Promise<Package[]> {
  return listPackages(hotelId, {
    statuses: ['ACTIVE'],
    approvalStatuses: ['APPROVED'],
    limit: 50,
  });
}

export async function getPackage(id: string): Promise<Package | null> {
  const { data, error } = await supabase
    .from('packages')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw parseError(error);
  return (data as Package | null) ?? null;
}

export async function getPackageEvents(packageId: string, limit = 100): Promise<PackageEvent[]> {
  const { data, error } = await supabase
    .from('package_events')
    .select('*')
    .eq('package_id', packageId)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) throw parseError(error);
  return (data ?? []) as PackageEvent[];
}

export async function getPackagePublic(
  hotelSlug: string,
  packageSlug: string,
): Promise<PublicPackagePayload | null> {
  const { data, error } = await supabase.rpc('get_package_public', {
    p_hotel_slug: hotelSlug,
    p_package_slug: packageSlug,
  });
  if (error) {
    const parsed = parseError(error);
    if (parsed.code === 'NOT_FOUND' || parsed.code === 'INVALID_REQUEST') return null;
    throw parsed;
  }
  return (data as PublicPackagePayload) ?? null;
}

// ─── Writes ────────────────────────────────────────────────────────────────

export interface CreatePackageInput {
  hotelId: string;
  name: string;
  slug: string;
  category: PackageCategory;
  durationNights: number;
  startingPriceText: string;
  shortPitch?: string;
  longDescription?: string;
  targetGuestType?: string;
  heroImageUrl?: string;
  minPartyAdults?: number;
  maxPartyAdults?: number;
  roomTypeId?: string | null;
  seasonMonths?: number[];
  validFrom?: string;
  validUntil?: string;
  foodInclusions?: string[];
  activityInclusions?: string[];
  transferInclusions?: string[];
  customInclusions?: string[];
  basePricePaise?: number | null;
  basePriceBasis?: PackagePricingBasis;
  enquiryCtaLabel?: string;
  internalNotes?: string;
}

export interface CreatePackageResult {
  id: string;
  status: PackageStatus;
}

export async function createPackage(input: CreatePackageInput): Promise<CreatePackageResult> {
  const { data, error } = await supabase.rpc('create_package', {
    p_hotel_id: input.hotelId,
    p_name: input.name,
    p_slug: input.slug,
    p_category: input.category,
    p_duration_nights: input.durationNights,
    p_starting_price_text: input.startingPriceText,
    p_short_pitch: input.shortPitch ?? null,
    p_long_description: input.longDescription ?? null,
    p_target_guest_type: input.targetGuestType ?? null,
    p_hero_image_url: input.heroImageUrl ?? null,
    p_min_party_adults: input.minPartyAdults ?? 1,
    p_max_party_adults: input.maxPartyAdults ?? null,
    p_room_type_id: input.roomTypeId ?? null,
    p_season_months: input.seasonMonths ?? [],
    p_valid_from: input.validFrom ?? null,
    p_valid_until: input.validUntil ?? null,
    p_food_inclusions: input.foodInclusions ?? [],
    p_activity_inclusions: input.activityInclusions ?? [],
    p_transfer_inclusions: input.transferInclusions ?? [],
    p_custom_inclusions: input.customInclusions ?? [],
    p_base_price_paise: input.basePricePaise ?? null,
    p_base_price_basis: input.basePriceBasis ?? 'PER_ROOM_PER_NIGHT',
    p_enquiry_cta_label: input.enquiryCtaLabel ?? 'Enquire now',
    p_internal_notes: input.internalNotes ?? null,
  });
  if (error) throw parseError(error);
  const obj = (data ?? {}) as { id?: string; status?: PackageStatus };
  if (!obj.id) throw new PackageServiceError('UNKNOWN_ERROR', 'No id returned');
  return { id: obj.id, status: obj.status ?? 'DRAFT' };
}

export interface UpdatePackageInput {
  id: string;
  name?: string;
  category?: PackageCategory;
  targetGuestType?: string;
  heroImageUrl?: string;
  clearHeroImage?: boolean;
  shortPitch?: string;
  longDescription?: string;
  durationNights?: number;
  minPartyAdults?: number;
  maxPartyAdults?: number;
  roomTypeId?: string;
  seasonMonths?: number[];
  validFrom?: string;
  validUntil?: string;
  foodInclusions?: string[];
  activityInclusions?: string[];
  transferInclusions?: string[];
  customInclusions?: string[];
  basePricePaise?: number;
  basePriceBasis?: PackagePricingBasis;
  startingPriceText?: string;
  enquiryCtaLabel?: string;
  internalNotes?: string;
}

export async function updatePackage(input: UpdatePackageInput): Promise<void> {
  const { error } = await supabase.rpc('update_package', {
    p_id: input.id,
    p_name: input.name ?? null,
    p_category: input.category ?? null,
    p_target_guest_type: input.targetGuestType ?? null,
    p_hero_image_url: input.heroImageUrl ?? null,
    p_short_pitch: input.shortPitch ?? null,
    p_long_description: input.longDescription ?? null,
    p_duration_nights: input.durationNights ?? null,
    p_min_party_adults: input.minPartyAdults ?? null,
    p_max_party_adults: input.maxPartyAdults ?? null,
    p_room_type_id: input.roomTypeId ?? null,
    p_season_months: input.seasonMonths ?? null,
    p_valid_from: input.validFrom ?? null,
    p_valid_until: input.validUntil ?? null,
    p_food_inclusions: input.foodInclusions ?? null,
    p_activity_inclusions: input.activityInclusions ?? null,
    p_transfer_inclusions: input.transferInclusions ?? null,
    p_custom_inclusions: input.customInclusions ?? null,
    p_base_price_paise: input.basePricePaise ?? null,
    p_base_price_basis: input.basePriceBasis ?? null,
    p_starting_price_text: input.startingPriceText ?? null,
    p_enquiry_cta_label: input.enquiryCtaLabel ?? null,
    p_internal_notes: input.internalNotes ?? null,
    p_clear_hero_image: input.clearHeroImage ?? false,
  });
  if (error) throw parseError(error);
}

export async function submitPackageForApproval(id: string): Promise<void> {
  const { error } = await supabase.rpc('submit_package_for_approval', { p_id: id });
  if (error) throw parseError(error);
}

export async function approvePackage(id: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('approve_package', {
    p_id: id,
    p_note: note ?? null,
  });
  if (error) throw parseError(error);
}

export async function requestPackageChanges(id: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('request_package_changes', {
    p_id: id,
    p_note: note,
  });
  if (error) throw parseError(error);
}

export async function publishPackage(id: string): Promise<void> {
  const { error } = await supabase.rpc('publish_package', { p_id: id });
  if (error) throw parseError(error);
}

export async function pausePackage(id: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('pause_package', {
    p_id: id,
    p_reason: reason ?? null,
  });
  if (error) throw parseError(error);
}

export async function resumePackage(id: string): Promise<void> {
  const { error } = await supabase.rpc('resume_package', { p_id: id });
  if (error) throw parseError(error);
}

export async function archivePackage(id: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('archive_package', {
    p_id: id,
    p_reason: reason ?? null,
  });
  if (error) throw parseError(error);
}

export async function duplicatePackage(
  sourceId: string,
  newName: string,
  newSlug: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('duplicate_package', {
    p_source_id: sourceId,
    p_new_name: newName,
    p_new_slug: newSlug,
  });
  if (error) throw parseError(error);
  const id = (data as { id?: string } | null)?.id;
  if (!id) throw new PackageServiceError('UNKNOWN_ERROR', 'No id returned');
  return id;
}

export async function softDeletePackage(id: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('soft_delete_package', {
    p_id: id,
    p_reason: reason ?? null,
  });
  if (error) throw parseError(error);
}

// ─── Analytics ─────────────────────────────────────────────────────────────

export interface PackageAnalytics {
  totalViews: number;
  windowDays: number;
  viewsPerPackage: Array<{ packageId: string; packageName: string; views: number }>;
}

export async function getPackageAnalytics(
  hotelId: string,
  days = 30,
): Promise<PackageAnalytics> {
  const { data, error } = await supabase.rpc('get_package_analytics', {
    p_hotel_id: hotelId,
    p_days: days,
  });
  if (error) throw parseError(error);
  const obj = (data ?? {}) as {
    total_views?: number;
    window_days?: number;
    views_per_package?: Array<{ package_id: string; package_name: string; views: number }>;
  };
  return {
    totalViews: Number(obj.total_views ?? 0),
    windowDays: Number(obj.window_days ?? days),
    viewsPerPackage: (obj.views_per_package ?? []).map((row) => ({
      packageId: row.package_id,
      packageName: row.package_name,
      views: Number(row.views ?? 0),
    })),
  };
}

// ─── Public view-tracker ───────────────────────────────────────────────────

export async function trackPackageView(input: {
  packageId: string;
  source?: string;
  referrer?: string;
}): Promise<void> {
  try {
    await supabase.functions.invoke('packages-track-view', {
      body: {
        package_id: input.packageId,
        source: input.source ?? null,
        referrer: input.referrer ?? null,
      },
    });
  } catch {
    // Best-effort — never bubble to the user
  }
}
