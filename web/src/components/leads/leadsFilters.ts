// web/src/components/leads/leadsFilters.ts
//
// Pure URL ↔ filter-state helpers for the Leads list view.
// No React, no Supabase — all logic testable in isolation.

import type {
  LeadListFilters,
  LeadOrderBy,
  LeadOrderDir,
  LeadSource,
  LeadStatus,
} from '../../types/lead';

export type SortOption =
  | 'activity_desc'
  | 'activity_asc'
  | 'created_desc'
  | 'created_asc'
  | 'value_desc'
  | 'value_asc';

export interface LeadFiltersUrlState {
  q?: string;
  status?: LeadStatus[];
  source?: LeadSource[];
  /** 'me' | 'unassigned' — specific-user picker deferred for v1. */
  assigned?: 'me' | 'unassigned';
  sort: SortOption;
  page: number;
}

export const DEFAULT_FILTERS: LeadFiltersUrlState = {
  sort: 'activity_desc',
  page: 1,
};

export const PAGE_SIZE = 50;

export interface SortMetadata {
  value: SortOption;
  label: string;
  orderBy: LeadOrderBy;
  orderDir: LeadOrderDir;
  nullsLast?: boolean;
}

export const SORT_OPTIONS: readonly SortMetadata[] = [
  { value: 'activity_desc', label: 'Recently active', orderBy: 'last_activity_at', orderDir: 'desc' },
  { value: 'activity_asc',  label: 'Least recent',    orderBy: 'last_activity_at', orderDir: 'asc' },
  { value: 'created_desc',  label: 'Newest first',    orderBy: 'created_at',       orderDir: 'desc' },
  { value: 'created_asc',   label: 'Oldest first',    orderBy: 'created_at',       orderDir: 'asc' },
  { value: 'value_desc',    label: 'Highest value',   orderBy: 'value_estimate',   orderDir: 'desc', nullsLast: true },
  { value: 'value_asc',     label: 'Lowest value',    orderBy: 'value_estimate',   orderDir: 'asc',  nullsLast: true },
] as const;

const KNOWN_SORTS = new Set<SortOption>(SORT_OPTIONS.map((o) => o.value));

const KNOWN_STATUSES = new Set<LeadStatus>([
  'NEW', 'QUALIFIED', 'QUOTED', 'WON', 'CONVERTED', 'LOST',
]);

const KNOWN_SOURCES = new Set<LeadSource>([
  'GOOGLE', 'WEBSITE', 'INSTAGRAM', 'FACEBOOK',
  'OTA', 'WALK_IN', 'REFERRAL',
  'AGENT', 'CORPORATE', 'WEDDING', 'GROUP', 'OTHER',
]);

const KNOWN_ASSIGNED = new Set<NonNullable<LeadFiltersUrlState['assigned']>>([
  'me', 'unassigned',
]);

// ─── URL → state (forgiving) ──────────────────────────────────────────────

export function searchParamsToFilters(sp: URLSearchParams): LeadFiltersUrlState {
  const q = sp.get('q') ?? undefined;

  const status = (sp.get('status') ?? '')
    .split(',')
    .filter((s) => s.length > 0)
    .filter((s): s is LeadStatus => KNOWN_STATUSES.has(s as LeadStatus));

  const source = (sp.get('source') ?? '')
    .split(',')
    .filter((s) => s.length > 0)
    .filter((s): s is LeadSource => KNOWN_SOURCES.has(s as LeadSource));

  const assignedRaw = sp.get('assigned') ?? undefined;
  const assigned = assignedRaw && KNOWN_ASSIGNED.has(assignedRaw as 'me' | 'unassigned')
    ? (assignedRaw as 'me' | 'unassigned')
    : undefined;

  const sortRaw = sp.get('sort') ?? '';
  const sort: SortOption = KNOWN_SORTS.has(sortRaw as SortOption)
    ? (sortRaw as SortOption)
    : DEFAULT_FILTERS.sort;

  const pageRaw = Number.parseInt(sp.get('page') ?? '1', 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  return {
    q: q && q.trim() !== '' ? q : undefined,
    status: status.length > 0 ? status : undefined,
    source: source.length > 0 ? source : undefined,
    assigned,
    sort,
    page,
  };
}

// ─── state → URL (omits defaults) ─────────────────────────────────────────

export function filtersToSearchParams(filters: LeadFiltersUrlState): URLSearchParams {
  const sp = new URLSearchParams();
  if (filters.q && filters.q.trim() !== '') sp.set('q', filters.q.trim());
  if (filters.status && filters.status.length > 0) sp.set('status', filters.status.join(','));
  if (filters.source && filters.source.length > 0) sp.set('source', filters.source.join(','));
  if (filters.assigned) sp.set('assigned', filters.assigned);
  if (filters.sort !== DEFAULT_FILTERS.sort) sp.set('sort', filters.sort);
  if (filters.page > 1) sp.set('page', String(filters.page));
  return sp;
}

// ─── URL filters → service-layer filters ──────────────────────────────────

/**
 * Translate URL filters → leadService.listLeads filter object.
 * Resolves 'me' against the current viewer's user id (so the URL stays
 * shareable across users — each viewer sees their own).
 */
export function toServiceFilters(
  filters: LeadFiltersUrlState,
  currentUserId: string | null,
): LeadListFilters {
  const sortMeta = SORT_OPTIONS.find((o) => o.value === filters.sort) ?? SORT_OPTIONS[0];

  let assignedTo: string | null | undefined;
  if (filters.assigned === 'me') {
    // currentUserId resolves "me" — caller is responsible for handling null
    // (unauthenticated session shouldn't reach this view, but be defensive).
    assignedTo = currentUserId ?? '__no-user__';
  } else if (filters.assigned === 'unassigned') {
    assignedTo = null;
  } else {
    assignedTo = undefined;
  }

  return {
    status: filters.status,
    source: filters.source,
    assignedTo,
    search: filters.q,
    orderBy: sortMeta.orderBy,
    orderDir: sortMeta.orderDir,
  };
}

/** Returns the nullsLast preference for the current sort option. */
export function nullsLastForSort(sort: SortOption): boolean {
  return SORT_OPTIONS.find((o) => o.value === sort)?.nullsLast === true;
}

// ─── Active-filter helpers ────────────────────────────────────────────────

export function hasActiveFilters(filters: LeadFiltersUrlState): boolean {
  return (
    (!!filters.q && filters.q.trim() !== '') ||
    (filters.status?.length ?? 0) > 0 ||
    (filters.source?.length ?? 0) > 0 ||
    !!filters.assigned
  );
}

/**
 * Count of distinct filter DIMENSIONS active (not the count of values within
 * each multi-select). E.g. {status: ['NEW', 'QUALIFIED'], source: ['WALK_IN']}
 * counts as 2, not 3.
 *
 * Rationale: matches operator mental model — "I have 2 filters on" — and
 * keeps the "Filters (2)" mobile chip from inflating with multi-selects.
 *
 * sort and page are presentation, not filters.
 */
export function activeFilterCount(filters: LeadFiltersUrlState): number {
  let count = 0;
  if (filters.q && filters.q.trim() !== '') count += 1;
  if (filters.status && filters.status.length > 0) count += 1;
  if (filters.source && filters.source.length > 0) count += 1;
  if (filters.assigned) count += 1;
  return count;
}
