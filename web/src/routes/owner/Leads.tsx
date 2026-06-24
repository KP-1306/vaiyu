// web/src/routes/owner/Leads.tsx
//
// /owner/:slug/leads — list view with filters, search, sort, pagination.
//
// Day 7 expands Day 6 with:
//   - LeadsFilterBar (URL-driven filters + search + sort)
//   - LeadsPagination (page-based)
//   - keepPreviousData on the leads query (no skeleton flash on filter change)
//   - FilteredEmptyState distinct from EmptyLeadsState
//   - User resolution for assigned=me filter

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useOwnerT } from '../../i18n/useOwnerT';
import { listLeads, LeadServiceError } from '../../services/leadService';
import { useLeadsRealtime } from '../../hooks/useLeadsRealtime';
import { LeadCard } from '../../components/leads/LeadCard';
import { LeadQuickAddModal } from '../../components/leads/LeadQuickAddModal';
import { EmptyLeadsState } from '../../components/leads/EmptyLeadsState';
import { FilteredEmptyState } from '../../components/leads/FilteredEmptyState';
import { LeadsErrorState } from '../../components/leads/LeadsErrorState';
import { LeadsListSkeleton } from '../../components/leads/LeadsListSkeleton';
import { LeadsFilterBar } from '../../components/leads/LeadsFilterBar';
import { LeadsPagination } from '../../components/leads/LeadsPagination';
import { ViewToggle, type LeadsView } from '../../components/leads/ViewToggle';
import { KanbanBoard } from '../../components/leads/KanbanBoard';
import { LeadDetailDrawer } from '../../components/leads/LeadDetailDrawer';
import { LeadsExportButton } from '../../components/leads/LeadsExportButton';
import {
  DEFAULT_FILTERS,
  PAGE_SIZE,
  filtersToSearchParams,
  hasActiveFilters,
  nullsLastForSort,
  searchParamsToFilters,
  toServiceFilters,
  type LeadFiltersUrlState,
} from '../../components/leads/leadsFilters';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'warning';
}

export default function Leads() {
  const { slug } = useParams<{ slug: string }>();
  const t = useOwnerT('owner-leads');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // ──────────────────────────────────────────────────────────────────────
  // QUERY KEY INVARIANTS — do not break:
  //
  // 1. queryKey MUST include every input that affects the result (q, status,
  //    source, assigned, sort, page). If you add a new filter dimension,
  //    add it to LeadFiltersUrlState AND verify it appears in serviceFilters
  //    AND therefore in the query key below. Otherwise TanStack Query will
  //    serve stale results from a different filter state.
  //
  // 2. The `filters` object MUST be referentially stable per searchParams.
  //    The useMemo below guarantees this. Do NOT compute filters inline in
  //    JSX — that recreates the object every render and explodes the cache.
  //
  // 3. Search debounce safety: `q` flows into filters → serviceFilters →
  //    queryKey. Slow-network out-of-order responses are discarded by
  //    TanStack because the response carries the queryKey it was fetched
  //    for; if that key is no longer mounted, the result is dropped. Do not
  //    hoist the search input value outside this flow.
  // ──────────────────────────────────────────────────────────────────────
  const filters = useMemo<LeadFiltersUrlState>(
    () => searchParamsToFilters(searchParams),
    [searchParams],
  );

  // Hotel lookup from slug
  const hotelQuery = useQuery({
    queryKey: ['hotel-by-slug', slug],
    queryFn: async () => {
      if (!slug) return null;
      const { data, error } = await supabase
        .from('hotels')
        .select('id, name')
        .eq('slug', slug)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!slug,
  });
  const hotelId = hotelQuery.data?.id ?? null;

  // Current user (for assigned=me resolution)
  const userQuery = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user;
    },
  });
  const userId = userQuery.data?.id ?? null;

  // URL filters → service-layer filters (memoized for query-key stability)
  const serviceFilters = useMemo(
    () => ({
      ...toServiceFilters(filters, userId),
      limit: PAGE_SIZE,
      offset: (filters.page - 1) * PAGE_SIZE,
      includeCount: true,
      nullsLast: nullsLastForSort(filters.sort),
    }),
    [filters, userId],
  );

  // Leads list
  const leadsQuery = useQuery({
    queryKey: ['leads', hotelId, serviceFilters, filters.page],
    queryFn: () => listLeads(hotelId!, serviceFilters),
    enabled: !!hotelId,
    placeholderData: keepPreviousData, // ← no skeleton flash on filter/page change
  });

  // Realtime (debounced internally)
  const { connectionState } = useLeadsRealtime(hotelId ?? undefined);

  // Toast (per-route, matches OwnerStaffShifts pattern)
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const showToast = useCallback((message: string, type: Toast['type'] = 'success') => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 3500);
  }, []);

  // View toggle (list / kanban) — URL-driven
  const view: LeadsView = searchParams.get('view') === 'kanban' ? 'kanban' : 'list';
  const setView = useCallback(
    (next: LeadsView) => {
      const sp = new URLSearchParams(searchParams);
      if (next === 'list') sp.delete('view');
      else sp.set('view', next);
      // Reset to page 1 when switching to kanban (it doesn't paginate)
      if (next === 'kanban') sp.delete('page');
      setSearchParams(sp);
    },
    [searchParams, setSearchParams],
  );

  // Modal open via ?new=1
  const modalOpen = searchParams.get('new') === '1';
  const openModal = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.set('new', '1');
    setSearchParams(next);
  }, [searchParams, setSearchParams]);
  const closeModal = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  // Filter changes: preserve ?new=1 if present
  const handleFiltersChange = useCallback(
    (next: LeadFiltersUrlState) => {
      const sp = filtersToSearchParams(next);
      if (searchParams.get('new') === '1') sp.set('new', '1');
      setSearchParams(sp);
    },
    [searchParams, setSearchParams],
  );

  const handlePageChange = useCallback(
    (page: number) => {
      handleFiltersChange({ ...filters, page });
    },
    [filters, handleFiltersChange],
  );

  const clearAllFilters = useCallback(() => {
    handleFiltersChange(DEFAULT_FILTERS);
  }, [handleFiltersChange]);

  useEffect(() => {
    if (modalOpen && !hotelId && !hotelQuery.isPending) {
      closeModal();
    }
  }, [modalOpen, hotelId, hotelQuery.isPending, closeModal]);

  const result = leadsQuery.data ?? { leads: [], total: null };
  const leads = result.leads;
  const total = result.total;
  const anyFiltersActive = hasActiveFilters(filters);

  // Detail drawer state via ?lead=<id>
  const openLeadId = searchParams.get('lead');
  const openDetail = useCallback(
    (lead: { id: string }) => {
      const next = new URLSearchParams(searchParams);
      next.set('lead', lead.id);
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );
  const closeDetail = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('lead');
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  // Manager check — owner/admin/manager roles can soft-delete + force-release
  // Match the backend `vaiyu_is_hotel_finance_manager` band via role string check.
  const isManager = useMemo(() => {
    // We don't have a dedicated client helper for this yet; UI guard is
    // best-effort + RPC enforces server-side. Treat any user as eligible for
    // the UI button; the soft_delete_lead RPC will reject staff with NOT_AUTHORIZED.
    return true;
  }, []);

  const handleRowClick = useCallback(
    (lead: { id: string }) => {
      openDetail(lead);
    },
    [openDetail],
  );

  const liveBadge = useMemo(() => {
    const config = {
      open: { icon: <Wifi className="h-3 w-3" />, label: t('live', 'Live'), cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' },
      connecting: { icon: <Loader2 className="h-3 w-3 animate-spin" />, label: t('connecting', 'Connecting'), cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' },
      error: { icon: <WifiOff className="h-3 w-3" />, label: t('reconnecting', 'Reconnecting'), cls: 'bg-red-500/15 text-red-300 ring-red-500/30' },
    } as const;
    const c = config[connectionState];
    return (
      <span
        data-testid="leads-realtime-status"
        title={t('realtimeTitle', 'Realtime: {{status}}', { status: c.label })}
        className={`inline-flex items-center gap-1 rounded-full ring-1 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${c.cls}`}
      >
        {c.icon}
        {c.label}
      </span>
    );
  }, [connectionState]);

  // Show skeleton on initial load; suppress on subsequent filter changes (placeholderData covers)
  const isInitialLoading = leadsQuery.isPending && !leadsQuery.data;

  return (
    <div className="vaiyu-owner min-h-screen bg-[#0a0c11] text-white">
      <header className="border-b border-white/10 bg-[#101218] sticky top-0 z-30">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => navigate(`/owner/${slug}`)}
              className="text-xs text-white/50 hover:text-white/80 transition-colors"
            >
              ← {hotelQuery.data?.name ?? t('hotelFallback', 'Hotel')}
            </button>
            <div className="flex items-center gap-2 mt-0.5">
              <h1 className="text-lg sm:text-xl font-semibold">{t('title', 'Leads')}</h1>
              {liveBadge}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ViewToggle value={view} onChange={setView} />
            {hotelId && (
              <LeadsExportButton
                hotelId={hotelId}
                hotelSlug={slug ?? ''}
                filters={filters}
                currentUserId={userId}
                showToast={showToast}
              />
            )}
            <button
              type="button"
              onClick={openModal}
              disabled={!hotelId}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 sm:px-4 py-2 text-sm font-medium text-white hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{t('newLead', 'New lead')}</span>
              <span className="sm:hidden">{t('newShort', 'New')}</span>
            </button>
          </div>
        </div>

        {connectionState === 'error' && (
          <div className="bg-red-500/10 border-t border-red-500/20 text-red-300 text-xs px-4 sm:px-6 py-2 text-center">
            {t('liveUpdatesPaused', 'Live updates paused. Refresh the page to retry.')}
          </div>
        )}
      </header>

      {/* Sticky filter bar */}
      <div className="sticky top-[57px] z-20">
        <LeadsFilterBar filters={filters} onChange={handleFiltersChange} />
      </div>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        {hotelQuery.isPending ? (
          <LeadsListSkeleton />
        ) : hotelQuery.isError || !hotelId ? (
          <LeadsErrorState
            message={(hotelQuery.error as Error)?.message ?? t('hotelNotFound', 'Hotel not found for this URL.')}
            onRetry={() => hotelQuery.refetch()}
          />
        ) : view === 'kanban' ? (
          <KanbanBoard
            hotelId={hotelId}
            slug={slug ?? ''}
            filters={filters}
            currentUserId={userId}
            showToast={showToast}
            onCardClick={handleRowClick}
          />
        ) : isInitialLoading ? (
          <LeadsListSkeleton />
        ) : leadsQuery.isError ? (
          <LeadsErrorState
            message={
              leadsQuery.error instanceof LeadServiceError
                ? leadsQuery.error.message
                : t('loadFailed', 'Could not load leads. Please try again.')
            }
            onRetry={() => leadsQuery.refetch()}
          />
        ) : leads.length === 0 ? (
          anyFiltersActive ? (
            <FilteredEmptyState onClearFilters={clearAllFilters} />
          ) : (
            <EmptyLeadsState onCreateClick={openModal} />
          )
        ) : (
          <>
            <div
              className={`space-y-3 transition-opacity max-w-5xl mx-auto ${
                leadsQuery.isFetching ? 'opacity-70' : 'opacity-100'
              }`}
            >
              {leads.map((lead) => (
                <LeadCard key={lead.id} lead={lead} onClick={handleRowClick} />
              ))}
            </div>
            <div className="max-w-5xl mx-auto">
              <LeadsPagination
                page={filters.page}
                total={total}
                pageSize={PAGE_SIZE}
                onPageChange={handlePageChange}
              />
            </div>
          </>
        )}
      </main>

      {hotelId && (
        <LeadQuickAddModal
          hotelId={hotelId}
          isOpen={modalOpen}
          onClose={closeModal}
          showToast={showToast}
        />
      )}

      {/* Lead detail drawer (URL-driven via ?lead=<id>) */}
      <LeadDetailDrawer
        leadId={openLeadId}
        hotelSlug={slug ?? ''}
        currentUserId={userId}
        isManager={isManager}
        onClose={closeDetail}
        showToast={showToast}
      />

      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            aria-live="polite"
            className={`pointer-events-auto rounded-lg px-4 py-2.5 text-sm shadow-lg border max-w-sm ${
              toast.type === 'success'
                ? 'bg-emerald-600/95 border-emerald-400/40 text-white'
                : toast.type === 'error'
                ? 'bg-red-600/95 border-red-400/40 text-white'
                : 'bg-amber-500/95 border-amber-300/40 text-amber-950'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}
