// web/src/routes/owner/FollowUpRadar.tsx
//
// /owner/:slug/follow-up — Follow-up Radar v1.
//
// v0 (mock-only) is preserved as a fallback when the hotel has no real
// follow-ups yet — so first-time visitors see a populated workspace and can
// learn the UI. As soon as the first real follow-up appears (auto-created
// by the Lead CRM trigger, or manually created), the mock fades and real
// data takes over.
//
// Reads:
//   - listFollowUps()        — RLS-scoped table read
//   - useFollowUpsRealtime() — debounced query invalidation on inserts/updates
//
// Writes (all via SECURITY DEFINER RPCs):
//   - mark_follow_up_addressed
//   - create_follow_up (via QuickAdd modal)
//   - sync_follow_ups_from_leads (manager-only backfill button)

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  Plus,
  Radar,
  RefreshCw,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  FOLLOW_UP_RADAR_V0_ENABLED,
  bucketFor,
  countByBucket,
  groupByBucket,
} from '../../config/followUpRadar';
import type {
  FollowUpBucket,
  FollowUpCategory,
  FollowUpItem,
  FollowUpPriority,
  FollowUpStatus,
} from '../../types/followUp';
import { FollowUpDisclaimerBanner } from '../../components/followup/FollowUpBlockedBanner';
import { FollowUpEmptyState } from '../../components/followup/FollowUpEmptyState';
import { FollowUpRow } from '../../components/followup/FollowUpRow';
import {
  FollowUpFilterBar,
  type RadarFilters,
} from '../../components/followup/FollowUpFilterBar';
import { FollowUpQuickAddModal } from '../../components/followup/FollowUpQuickAddModal';
import {
  dismissFollowUp,
  listFollowUps,
  markFollowUpAddressed,
  markFollowUpBlocked,
  reopenFollowUp,
  syncFollowUpsFromLeads,
  unblockFollowUp,
} from '../../services/followUpService';
import { useFollowUpsRealtime } from '../../hooks/useFollowUpsRealtime';
import { track } from '../../lib/analytics';

const BUCKET_ORDER: FollowUpBucket[] = [
  'DUE_TODAY',
  'OVERDUE',
  'BLOCKED',
  'PENDING',
  'ADDRESSED',
];

const BUCKET_LABEL: Record<FollowUpBucket, string> = {
  DUE_TODAY: 'Due today',
  OVERDUE: 'Overdue',
  BLOCKED: 'Blocked — guest issue first',
  PENDING: 'Coming up',
  ADDRESSED: 'Already addressed',
};

const BUCKET_TONE: Record<FollowUpBucket, string> = {
  DUE_TODAY: 'text-emerald-200',
  OVERDUE: 'text-red-200',
  BLOCKED: 'text-red-200',
  PENDING: 'text-slate-200',
  ADDRESSED: 'text-slate-400',
};

interface HotelRow {
  id: string;
  name: string;
  slug: string;
}

const ALLOWED_CATEGORIES = new Set<FollowUpCategory>([
  'DIRECT_ENQUIRY', 'QUOTE_SENT', 'PACKAGE_ENQUIRY',
  'REVIEW_REQUEST', 'OWNER_REPLY',
  'UNRESOLVED_COMPLAINT', 'SLA_ESCALATION',
]);
const ALLOWED_STATUSES = new Set<FollowUpStatus>([
  'PENDING', 'DUE', 'OVERDUE', 'BLOCKED', 'ADDRESSED',
]);
const ALLOWED_PRIORITIES = new Set<FollowUpPriority>([
  'CRITICAL', 'HIGH', 'MEDIUM', 'LOW',
]);

function filtersFromUrl(sp: URLSearchParams): RadarFilters {
  const csv = (k: string) => sp.get(k)?.split(',').filter(Boolean) ?? [];
  return {
    categories: csv('category').filter((v): v is FollowUpCategory =>
      ALLOWED_CATEGORIES.has(v as FollowUpCategory),
    ),
    statuses: csv('status').filter((v): v is FollowUpStatus =>
      ALLOWED_STATUSES.has(v as FollowUpStatus),
    ),
    priorities: csv('priority').filter((v): v is FollowUpPriority =>
      ALLOWED_PRIORITIES.has(v as FollowUpPriority),
    ),
  };
}

function filtersToUrl(f: RadarFilters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.categories.length) sp.set('category', f.categories.join(','));
  if (f.statuses.length) sp.set('status', f.statuses.join(','));
  if (f.priorities.length) sp.set('priority', f.priorities.join(','));
  return sp;
}

function applyFilters(items: FollowUpItem[], f: RadarFilters): FollowUpItem[] {
  return items.filter((it) => {
    if (f.categories.length && !f.categories.includes(it.category)) return false;
    if (f.statuses.length && !f.statuses.includes(it.status)) return false;
    if (f.priorities.length && !f.priorities.includes(it.priority)) return false;
    return true;
  });
}

export default function FollowUpRadar() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Resolve hotel by slug
  const hotelQ = useQuery<HotelRow | null>({
    queryKey: ['follow-ups', 'hotel', slug],
    queryFn: async () => {
      if (!slug) return null;
      const { data, error } = await supabase
        .from('hotels')
        .select('id, name, slug')
        .eq('slug', slug)
        .maybeSingle();
      if (error) throw error;
      return data as HotelRow | null;
    },
    enabled: !!slug,
    staleTime: 60_000,
  });
  const hotel = hotelQ.data ?? null;
  useFollowUpsRealtime(hotel?.id);

  // Real follow-ups
  const listQ = useQuery({
    queryKey: hotel?.id ? ['follow-ups', 'list', hotel.id] : ['follow-ups', 'list', null],
    queryFn: () =>
      hotel?.id
        ? listFollowUps(hotel.id, { includeAddressed: true })
        : Promise.resolve({ items: [], raw: [] }),
    enabled: !!hotel?.id,
    staleTime: 15_000,
  });

  // Real data only — no mock fallback. Empty hotels see a proper empty state.
  const items = useMemo<FollowUpItem[]>(() => listQ.data?.items ?? [], [listQ.data]);
  const isEmpty = listQ.isSuccess && items.length === 0;

  const filters = filtersFromUrl(searchParams);
  const filtered = useMemo(() => applyFilters(items, filters), [items, filters]);
  const counts = useMemo(() => countByBucket(items), [items]);

  const invalidateList = useCallback(() => {
    if (hotel?.id) qc.invalidateQueries({ queryKey: ['follow-ups', 'list', hotel.id] });
  }, [hotel?.id, qc]);

  const addressMutation = useMutation({
    mutationFn: async (id: string) => markFollowUpAddressed(id),
    onSuccess: invalidateList,
  });
  const dismissMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string | null }) =>
      dismissFollowUp(id, reason ?? undefined),
    onSuccess: invalidateList,
  });
  const blockMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      markFollowUpBlocked(id, reason),
    onSuccess: invalidateList,
  });
  const unblockMutation = useMutation({
    mutationFn: async (id: string) => unblockFollowUp(id),
    onSuccess: invalidateList,
  });
  const reopenMutation = useMutation({
    mutationFn: async (id: string) => reopenFollowUp(id),
    onSuccess: invalidateList,
  });

  function handleFiltersChange(next: RadarFilters) {
    setSearchParams(filtersToUrl(next), { replace: true });
    track('follow_up_filter_applied', {
      categories: next.categories.length,
      statuses: next.statuses.length,
      priorities: next.priorities.length,
    });
  }
  function handleClearFilters() {
    setSearchParams(new URLSearchParams(), { replace: true });
    track('follow_up_filter_cleared', {});
  }

  const handleMarkAddressed = useCallback(
    (id: string) => {
      addressMutation.mutate(id);
      track('follow_up_mark_addressed', { id });
    },
    [addressMutation],
  );
  const handleDismiss = useCallback(
    (id: string, reason: string | null) => {
      dismissMutation.mutate({ id, reason });
      track('follow_up_dismissed', { id, hasReason: !!reason });
    },
    [dismissMutation],
  );
  const handleBlock = useCallback(
    (id: string, reason: string) => {
      blockMutation.mutate({ id, reason });
      track('follow_up_blocked', { id });
    },
    [blockMutation],
  );
  const handleUnblock = useCallback(
    (id: string) => {
      unblockMutation.mutate(id);
      track('follow_up_unblocked', { id });
    },
    [unblockMutation],
  );
  const handleReopen = useCallback(
    (id: string) => {
      reopenMutation.mutate(id);
      track('follow_up_reopened', { id });
    },
    [reopenMutation],
  );

  // Build a lookup for dismissed state from the raw rows
  const dismissedIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of listQ.data?.raw ?? []) {
      if (r.dismissed_at) set.add(r.id);
    }
    return set;
  }, [listQ.data?.raw]);

  const groupedRendered = useMemo(() => groupByBucket(filtered), [filtered]);

  const handleSync = useCallback(async () => {
    if (!hotel?.id) return;
    setSyncError(null);
    try {
      const out = await syncFollowUpsFromLeads(hotel.id);
      track('follow_up_sync_from_leads', { created: out.created });
      qc.invalidateQueries({ queryKey: ['follow-ups', 'list', hotel.id] });
    } catch (e) {
      setSyncError((e as Error).message ?? 'Sync failed');
    }
  }, [hotel?.id, qc]);

  if (!FOLLOW_UP_RADAR_V0_ENABLED) {
    return (
      <main className="min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200">
        <p className="text-sm text-slate-400">Follow-up Radar is not enabled.</p>
      </main>
    );
  }

  if (hotelQ.isLoading) {
    return (
      <main className="min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200">
        <Loader2 className="h-5 w-5 animate-spin text-slate-500" aria-hidden />
      </main>
    );
  }

  if (!hotel) {
    return (
      <main className="min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200">
        <p className="text-sm text-slate-300">Hotel not found.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0B0E14] text-slate-200">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6">
        <header className="mb-6 space-y-4">
          <Link
            to={`/owner/${slug ?? ''}`}
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back to dashboard
          </Link>

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <Radar className="h-5 w-5 text-emerald-300" aria-hidden />
                <h1 className="text-xl sm:text-2xl font-semibold text-slate-50">
                  Follow-up Radar
                </h1>
              </div>
              <p className="mt-1 text-sm text-slate-400 max-w-xl">
                A safe, manual reminder workspace. New leads auto-create follow-ups; sent
                quotes auto-create nudge reminders. You decide what to act on next.
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <Badge tone="emerald" label="Due today" value={counts.dueToday} />
              <Badge tone="red" label="Overdue" value={counts.overdue} />
              <Badge tone="amber" label="Blocked" value={counts.blocked} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setQuickAddOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20"
              data-testid="follow-up-add-button"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add follow-up
            </button>
            <button
              type="button"
              onClick={handleSync}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
              data-testid="follow-up-sync-button"
              title="Backfill follow-ups for any leads that existed before this feature."
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Sync from leads
            </button>
            {syncError && (
              <span className="text-[11px] text-red-300">{syncError}</span>
            )}
          </div>
        </header>

        <FollowUpDisclaimerBanner />

        <div className="mt-5 grid gap-5 lg:grid-cols-[280px,1fr]">
          <aside className="space-y-4">
            <FollowUpFilterBar
              filters={filters}
              onChange={handleFiltersChange}
              onClear={handleClearFilters}
              totalShown={filtered.length}
              totalAll={items.length}
            />
          </aside>

          <section className="space-y-5">
            {listQ.isLoading && (
              <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-8 text-center">
                <Loader2 className="h-4 w-4 animate-spin text-slate-500 mx-auto" aria-hidden />
              </div>
            )}

            {!listQ.isLoading && isEmpty && (
              <FollowUpEmptyState
                hotelSlug={slug ?? ''}
                onAddClick={() => setQuickAddOpen(true)}
              />
            )}

            {!listQ.isLoading && !isEmpty && BUCKET_ORDER.map((bucket) => {
              const list = groupedRendered[bucket];
              if (list.length === 0) return null;
              return (
                <section key={bucket} data-testid={`follow-up-section-${bucket}`}>
                  <div className="flex items-baseline justify-between mb-2">
                    <h2 className={`text-sm font-semibold ${BUCKET_TONE[bucket]}`}>
                      {BUCKET_LABEL[bucket]}
                    </h2>
                    <span className="text-[11px] text-slate-500">{list.length}</span>
                  </div>
                  <div className="space-y-3">
                    {list.map((item) => (
                      <FollowUpRow
                        key={item.id}
                        item={item}
                        isAddressedOverlay={false}
                        dismissed={dismissedIds.has(item.id)}
                        onMarkAddressed={handleMarkAddressed}
                        onDismiss={handleDismiss}
                        onBlock={handleBlock}
                        onUnblock={handleUnblock}
                        onReopen={handleReopen}
                      />
                    ))}
                  </div>
                </section>
              );
            })}

            {!listQ.isLoading && !isEmpty && filtered.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-700 bg-[#0F1320] p-8 text-center">
                <p className="text-sm text-slate-300">No follow-ups match these filters.</p>
                <p className="mt-1 text-xs text-slate-500">
                  Try clearing one or two pills to widen the view.
                </p>
              </div>
            )}
          </section>
        </div>

        <footer className="mt-8 text-[11px] text-slate-500">
          Follow-up Radar — manual reminder workspace. No messages are sent and no tickets
          are updated from this page. {summaryLine(items, bucketFor)}
        </footer>
      </div>

      <FollowUpQuickAddModal
        open={quickAddOpen}
        hotelId={hotel.id}
        onClose={() => setQuickAddOpen(false)}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ['follow-ups', 'list', hotel.id] });
        }}
      />
    </main>
  );
}

function summaryLine(
  items: FollowUpItem[],
  bucketize: (i: FollowUpItem) => FollowUpBucket,
): string {
  const counts: Record<FollowUpBucket, number> = {
    DUE_TODAY: 0,
    OVERDUE: 0,
    BLOCKED: 0,
    PENDING: 0,
    ADDRESSED: 0,
  };
  for (const it of items) counts[bucketize(it)] += 1;
  return `Snapshot: ${counts.DUE_TODAY} due today, ${counts.OVERDUE} overdue, ${counts.BLOCKED} blocked.`;
}

function Badge({
  tone,
  label,
  value,
}: {
  tone: 'emerald' | 'red' | 'amber';
  label: string;
  value: number;
}) {
  const cls =
    tone === 'emerald'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
      : tone === 'red'
      ? 'border-red-500/40 bg-red-500/10 text-red-200'
      : 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${cls}`}>
      <span className="font-semibold">{value}</span>
      <span className="opacity-80">{label}</span>
    </span>
  );
}
