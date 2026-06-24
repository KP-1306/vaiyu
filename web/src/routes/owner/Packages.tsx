// web/src/routes/owner/Packages.tsx
//
// /owner/:slug/packages — workspace.

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Plus, Tent } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  PACKAGE_BUILDER_V0_ENABLED,
  PACKAGE_CATEGORY_LABEL,
  PACKAGE_CATEGORY_OPTIONS,
  PACKAGE_STATUS_LABEL,
} from '../../config/packages';
import type {
  Package,
  PackageCategory,
  PackageStatus,
} from '../../types/package';
import { listPackages, getPackageAnalytics } from '../../services/packageService';
import { usePackagesRealtime } from '../../hooks/usePackagesRealtime';
import { packageQueryKeys } from '../../services/packageQueryKeys';
import { PackageCard } from '../../components/packages/PackageCard';
import { PackageEmptyState } from '../../components/packages/PackageEmptyState';
import { PackageDisclaimerBanner } from '../../components/packages/PackageDisclaimerBanner';
import { useOwnerT } from '../../i18n/useOwnerT';

interface HotelRow { id: string; name: string; slug: string }

const ALL_STATUSES: PackageStatus[] = ['DRAFT', 'READY', 'ACTIVE', 'PAUSED', 'ARCHIVED'];

function statusesFromUrl(sp: URLSearchParams): PackageStatus[] {
  const csv = sp.get('status')?.split(',').filter(Boolean) ?? [];
  return csv.filter((v): v is PackageStatus => (ALL_STATUSES as string[]).includes(v));
}

function categoriesFromUrl(sp: URLSearchParams): PackageCategory[] {
  const csv = sp.get('category')?.split(',').filter(Boolean) ?? [];
  return csv.filter((v): v is PackageCategory => (PACKAGE_CATEGORY_OPTIONS as string[]).includes(v));
}

export default function Packages() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const t = useOwnerT('owner-packages');
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('q') ?? '');

  const hotelQ = useQuery<HotelRow | null>({
    queryKey: ['packages', 'hotel', slug],
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
  usePackagesRealtime(hotel?.id);

  const statuses = statusesFromUrl(searchParams);
  const categories = categoriesFromUrl(searchParams);

  const listQ = useQuery({
    queryKey: hotel?.id
      ? [...packageQueryKeys.list(hotel.id), statuses.join(','), categories.join(','), search]
      : ['packages', 'noop'],
    queryFn: () =>
      hotel?.id
        ? listPackages(hotel.id, {
            statuses: statuses.length ? statuses : undefined,
            categories: categories.length ? categories : undefined,
            search: search.trim() || undefined,
          })
        : Promise.resolve([] as Package[]),
    enabled: !!hotel?.id,
    staleTime: 15_000,
  });

  const analyticsQ = useQuery({
    queryKey: hotel?.id ? packageQueryKeys.analytics(hotel.id, 7) : ['package-analytics', 'noop'],
    queryFn: () => (hotel?.id ? getPackageAnalytics(hotel.id, 7) : Promise.resolve(null)),
    enabled: !!hotel?.id,
    staleTime: 60_000,
  });

  const viewsByPackage = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of analyticsQ.data?.viewsPerPackage ?? []) {
      map[row.packageId] = row.views;
    }
    return map;
  }, [analyticsQ.data]);

  const toggleStatus = useCallback((s: PackageStatus) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    const sp = new URLSearchParams(searchParams);
    if (next.length === 0) sp.delete('status'); else sp.set('status', next.join(','));
    setSearchParams(sp, { replace: true });
  }, [statuses, searchParams, setSearchParams]);

  const toggleCategory = useCallback((c: PackageCategory) => {
    const next = categories.includes(c) ? categories.filter((x) => x !== c) : [...categories, c];
    const sp = new URLSearchParams(searchParams);
    if (next.length === 0) sp.delete('category'); else sp.set('category', next.join(','));
    setSearchParams(sp, { replace: true });
  }, [categories, searchParams, setSearchParams]);

  function applySearch() {
    const sp = new URLSearchParams(searchParams);
    if (search.trim()) sp.set('q', search.trim());
    else sp.delete('q');
    setSearchParams(sp, { replace: true });
  }

  if (!PACKAGE_BUILDER_V0_ENABLED) {
    return (
      <main className="vaiyu-owner min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200">
        <p className="text-sm text-slate-400">{t('workspace.notEnabled', 'Package Builder is not enabled.')}</p>
      </main>
    );
  }

  if (hotelQ.isLoading) {
    return (
      <main className="vaiyu-owner min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200">
        <Loader2 className="h-5 w-5 animate-spin text-slate-500" aria-hidden />
      </main>
    );
  }

  if (!hotel) {
    return (
      <main className="vaiyu-owner min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200">
        <p className="text-sm text-slate-300">{t('workspace.hotelNotFound', 'Hotel not found.')}</p>
      </main>
    );
  }

  const packages = listQ.data ?? [];
  const isEmpty = listQ.isSuccess && packages.length === 0
    && statuses.length === 0 && categories.length === 0 && !search.trim();

  return (
    <main className="vaiyu-owner min-h-screen bg-[#0B0E14] text-slate-200">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-5">
        <header className="space-y-4">
          <Link
            to={`/owner/${slug ?? ''}`}
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            {t('workspace.back', 'Back to dashboard')}
          </Link>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <Tent className="h-5 w-5 text-emerald-300" aria-hidden />
                <h1 className="text-xl sm:text-2xl font-semibold text-slate-50">{t('workspace.title', 'Experience Packages')}</h1>
              </div>
              <p className="mt-1 text-sm text-slate-400 max-w-xl">
                {t('workspace.subtitle', 'Build packages your team can share via WhatsApp or link to from your website. Each package has a public landing page once approved.')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/owner/${slug}/packages/new`)}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3.5 py-2 text-xs font-medium text-emerald-100 hover:bg-emerald-500/25"
              data-testid="package-create-button"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('workspace.newPackage', 'New package')}
            </button>
          </div>
        </header>

        <PackageDisclaimerBanner />

        {/* Filters */}
        <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applySearch(); }}
              placeholder={t('workspace.searchPlaceholder', 'Search by name, pitch, or target guest')}
              className="flex-1 min-w-[200px] rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
              data-testid="package-search"
            />
            <button
              type="button"
              onClick={applySearch}
              className="rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
            >
              {t('workspace.search', 'Search')}
            </button>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t('workspace.statusLabel', 'Status')}</div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStatus(s)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                    statuses.includes(s)
                      ? 'bg-emerald-500/20 text-emerald-100 border-emerald-500/50'
                      : 'bg-slate-800/60 text-slate-300 border-slate-700 hover:bg-slate-800'
                  }`}
                  data-testid={`package-status-filter-${s}`}
                >
                  {t(`status.${s}`, PACKAGE_STATUS_LABEL[s])}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t('workspace.categoryLabel', 'Category')}</div>
            <div className="flex flex-wrap gap-1.5">
              {PACKAGE_CATEGORY_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCategory(c)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                    categories.includes(c)
                      ? 'bg-emerald-500/20 text-emerald-100 border-emerald-500/50'
                      : 'bg-slate-800/60 text-slate-300 border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  {t(`category.${c}`, PACKAGE_CATEGORY_LABEL[c])}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* List */}
        {listQ.isLoading ? (
          <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-8 text-center">
            <Loader2 className="h-4 w-4 animate-spin text-slate-500 mx-auto" aria-hidden />
          </div>
        ) : isEmpty ? (
          <PackageEmptyState onCreate={() => navigate(`/owner/${slug}/packages/new`)} />
        ) : packages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-[#0F1320] p-8 text-center">
            <p className="text-sm text-slate-300">{t('workspace.noMatchTitle', 'No packages match these filters.')}</p>
            <p className="mt-1 text-xs text-slate-500">{t('workspace.noMatchHint', 'Try clearing one or two filters to widen the view.')}</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {packages.map((pkg) => (
              <PackageCard
                key={pkg.id}
                pkg={pkg}
                hotelSlug={hotel.slug}
                views7d={viewsByPackage[pkg.id] ?? 0}
                onEdit={() => navigate(`/owner/${slug}/packages/${pkg.id}`)}
                onOpenMenu={() => navigate(`/owner/${slug}/packages/${pkg.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
