// web/src/routes/owner/Partners.tsx
//
// Partner Network directory — Position 4 of the growth sheet.
// Renamed in UI per PO brief: "Local Partner Directory" / "Verified Local
// Partners". NOT a public marketplace.
//
// Layout:
//   • Header (hotel + slug)
//   • Filter bar (search + kind + status chips + include-archived toggle)
//   • Counters strip (Total / Verified / Preferred / Stale)
//   • Directory table (sortable by recently-updated)
//   • Detail drawer (opened by row click)
//   • Liability disclaimer footer
//
// Auth: relies on existing /owner/:slug route shell.

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Loader2, Plus, Search, Archive } from 'lucide-react';

import { supabase } from '../../lib/supabase';
import { PARTNER_NETWORK_V1_ENABLED } from '../../config/partnerNetwork';
import { listPartners } from '../../services/partnerService';
import {
  PARTNER_CATEGORY_LABEL,
  type PartnerCategory,
  type PartnerDirectoryRow,
  type PartnerKind,
  type PartnerStatus,
  type PartnerVerificationStatus,
} from '../../types/partner';
import { useOwnerT } from '../../i18n/useOwnerT';

import {
  PartnerCategoryBadge,
  PartnerKindBadge,
  PartnerStatusBadge,
  PartnerVerificationBadge,
} from '../../components/partner/PartnerBadges';
import { PartnerFormModal } from '../../components/partner/PartnerFormModal';
import { PartnerDetailDrawer } from '../../components/partner/PartnerDetailDrawer';
import { PartnerLiabilityFooter } from '../../components/partner/PartnerLiabilityFooter';

interface Hotel { id: string; name: string; slug: string; }

export default function Partners() {
  const t = useOwnerT('owner-partner');
  const { slug: rawSlug } = useParams();
  const slug = (rawSlug ?? '').trim();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [hotelLoading, setHotelLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<PartnerKind | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<Set<PartnerStatus>>(new Set());
  const [verificationFilter, setVerificationFilter] = useState<Set<PartnerVerificationStatus>>(new Set());
  const [includeArchived, setIncludeArchived] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialKind, setCreateInitialKind] = useState<PartnerKind>('VENDOR');
  const [drawerId, setDrawerId] = useState<string | null>(null);

  // Fetch hotel by slug
  useEffect(() => {
    let cancelled = false;
    async function fetchHotel() {
      setHotelLoading(true);
      const { data } = await supabase
        .from('hotels')
        .select('id, name, slug')
        .eq('slug', slug)
        .maybeSingle();
      if (!cancelled) {
        setHotel((data as Hotel | null) ?? null);
        setHotelLoading(false);
      }
    }
    if (slug) fetchHotel();
    return () => { cancelled = true; };
  }, [slug]);

  const partnersQ = useQuery({
    queryKey: ['partners', hotel?.id, kindFilter, [...statusFilter].sort(), [...verificationFilter].sort(), includeArchived, search.trim()],
    queryFn: () => listPartners(hotel!.id, {
      kinds: kindFilter === 'ALL' ? undefined : [kindFilter],
      statuses: statusFilter.size > 0 ? [...statusFilter] : undefined,
      verificationStatuses: verificationFilter.size > 0 ? [...verificationFilter] : undefined,
      includeArchived,
      search: search.trim() || undefined,
      limit: 200,
    }),
    enabled: !!hotel?.id,
    staleTime: 10_000,
  });

  const counters = useMemo(() => summariseDirectory(partnersQ.data ?? []), [partnersQ.data]);

  const kindOptions = [
    { value: 'ALL' as const, label: t('filter.allKinds', 'All kinds') },
    { value: 'VENDOR' as const, label: t('filter.vendors', 'Vendors') },
    { value: 'AGENT' as const, label: t('filter.agents', 'Agents') },
  ];
  const statusFilterOptions: { value: PartnerStatus; label: string }[] = [
    { value: 'DRAFT',      label: t('status.DRAFT', 'Draft') },
    { value: 'VERIFIED',   label: t('status.VERIFIED', 'Verified') },
    { value: 'PREFERRED',  label: t('status.PREFERRED', 'Preferred') },
    { value: 'BACKUP',     label: t('status.BACKUP', 'Backup') },
    { value: 'INACTIVE',   label: t('status.INACTIVE', 'Inactive') },
    { value: 'DO_NOT_USE', label: t('status.DO_NOT_USE', 'Do not use') },
  ];
  const verificationFilterOptions: { value: PartnerVerificationStatus; label: string }[] = [
    { value: 'UNVERIFIED', label: t('verification.UNVERIFIED', 'Not verified') },
    { value: 'PENDING',    label: t('verification.PENDING', 'Verification pending') },
    { value: 'VERIFIED',   label: t('verification.VERIFIED', 'Verified') },
    { value: 'REJECTED',   label: t('verification.REJECTED', 'Rejected') },
  ];

  if (!PARTNER_NETWORK_V1_ENABLED) {
    return (
      <main className="vaiyu-owner mx-auto max-w-6xl px-4 py-10 text-slate-300">
        <p>{t('notEnabled', 'Partner Network is disabled.')}</p>
      </main>
    );
  }

  if (hotelLoading) {
    return (
      <main className="vaiyu-owner mx-auto max-w-6xl px-4 py-10 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </main>
    );
  }
  if (!hotel) {
    return (
      <main className="vaiyu-owner mx-auto max-w-6xl px-4 py-10 text-slate-300">
        <p>{t('notFound', 'Hotel not found for slug {{slug}}.', { slug })}</p>
      </main>
    );
  }

  return (
    <main className="vaiyu-owner min-h-screen bg-[#070914] text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-5">
          <p className="text-[11px] uppercase tracking-widest text-slate-500">{t('page.breadcrumb', 'Growth')} · {hotel.name}</p>
          <h1 className="mt-1 text-2xl font-semibold">{t('page.title', 'Local Partner Directory')}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {t('page.subtitle', 'Verified vendors and commissionable agents you trust. Manage status, verification, and (for agents) commission payouts.')}
          </p>
        </header>

        {/* Counters */}
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Counter label={t('counter.total', 'Total')}         value={counters.total} />
          <Counter label={t('counter.verified', 'Verified')}   value={counters.verified} tone="emerald" />
          <Counter label={t('counter.preferred', 'Preferred')} value={counters.preferred} tone="amber" />
          <Counter label={t('counter.stale', 'Stale')}         value={counters.stale} tone={counters.stale > 0 ? 'red' : 'neutral'} />
        </div>

        {/* Filter bar */}
        <div className="mb-4 space-y-3 rounded-lg border border-slate-800 bg-[#0F1320] p-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('filter.searchPlaceholder', 'Search by name or service area')}
                className="w-full rounded-md border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-400 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1">
              {kindOptions.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setKindFilter(k.value)}
                  className={
                    kindFilter === k.value
                      ? 'rounded-md border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-medium text-emerald-200'
                      : 'rounded-md border border-slate-700 px-3 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800'
                  }
                >
                  {k.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setCreateInitialKind(kindFilter === 'AGENT' ? 'AGENT' : 'VENDOR');
                setCreateOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
              data-testid="partner-add-button"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> {t('action.addPartner', 'Add partner')}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {statusFilterOptions.map((s) => {
              const on = statusFilter.has(s.value);
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => {
                    setStatusFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.value)) next.delete(s.value); else next.add(s.value);
                      return next;
                    });
                  }}
                  className={
                    on
                      ? 'rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-200'
                      : 'rounded-full border border-slate-700 px-2.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400 hover:bg-slate-800'
                  }
                >
                  {s.label}
                </button>
              );
            })}
            <span className="text-[10px] text-slate-500">·</span>
            {verificationFilterOptions.map((v) => {
              const on = verificationFilter.has(v.value);
              return (
                <button
                  key={v.value}
                  type="button"
                  onClick={() => {
                    setVerificationFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(v.value)) next.delete(v.value); else next.add(v.value);
                      return next;
                    });
                  }}
                  className={
                    on
                      ? 'rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-200'
                      : 'rounded-full border border-slate-700 px-2.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400 hover:bg-slate-800'
                  }
                >
                  {v.label}
                </button>
              );
            })}
            <span className="text-[10px] text-slate-500">·</span>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
                className="h-3 w-3 rounded border-slate-600 bg-slate-900"
              />
              <Archive className="h-3 w-3" aria-hidden /> {t('filter.includeArchived', 'Include archived')}
            </label>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">{t('table.name', 'Name')}</th>
                <th className="px-3 py-2 text-left">{t('table.kindCategory', 'Kind / Category')}</th>
                <th className="px-3 py-2 text-left">{t('table.status', 'Status')}</th>
                <th className="px-3 py-2 text-left">{t('table.verification', 'Verification')}</th>
                <th className="px-3 py-2 text-right">{t('table.leads', 'Leads')}</th>
                <th className="px-3 py-2 text-right">{t('table.outstanding', 'Outstanding')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {partnersQ.isLoading && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  <Loader2 className="inline h-4 w-4 animate-spin" />
                </td></tr>
              )}
              {!partnersQ.isLoading && (partnersQ.data?.length ?? 0) === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  {t('table.noPartners', 'No partners match the current filters.')}
                </td></tr>
              )}
              {partnersQ.data?.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => setDrawerId(p.id)}
                  className={`cursor-pointer hover:bg-slate-800/40 ${p.is_archived ? 'opacity-60' : ''}`}
                  data-testid="partner-row"
                >
                  <td className="px-3 py-2">
                    <div className="text-slate-100">{p.partner_name}</div>
                    <div className="text-[10.5px] text-slate-500">
                      {p.service_area || t('table.noArea', 'No area set')}
                      {p.contact_phone && ` · ${p.contact_phone}`}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <PartnerKindBadge kind={p.kind} />
                      <PartnerCategoryBadge category={p.category} />
                    </div>
                  </td>
                  <td className="px-3 py-2"><PartnerStatusBadge status={p.status} /></td>
                  <td className="px-3 py-2">
                    <PartnerVerificationBadge status={p.verification_status} isStale={p.is_verification_stale} />
                  </td>
                  <td className="px-3 py-2 text-right text-slate-300">{p.lead_count}</td>
                  <td className="px-3 py-2 text-right">
                    {p.kind === 'AGENT'
                      ? <span className="text-amber-200">₹{Number(p.commission_outstanding_inr).toLocaleString('en-IN')}</span>
                      : <span className="text-slate-500">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <PartnerLiabilityFooter />
      </div>

      {createOpen && (
        <PartnerFormModal
          open
          mode="create"
          hotelId={hotel.id}
          initialKind={createInitialKind}
          onClose={() => setCreateOpen(false)}
          onSaved={(id) => {
            setCreateOpen(false);
            setDrawerId(id);
            partnersQ.refetch();
          }}
        />
      )}

      <PartnerDetailDrawer
        open={!!drawerId}
        partnerId={drawerId}
        onClose={() => setDrawerId(null)}
      />
    </main>
  );
}

interface DirectoryCounters {
  total: number;
  verified: number;
  preferred: number;
  stale: number;
}

function summariseDirectory(rows: PartnerDirectoryRow[]): DirectoryCounters {
  let verified = 0, preferred = 0, stale = 0;
  for (const r of rows) {
    if (r.verification_status === 'VERIFIED') verified++;
    if (r.status === 'PREFERRED') preferred++;
    if (r.is_verification_stale) stale++;
  }
  return { total: rows.length, verified, preferred, stale };
}

function Counter({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'emerald' | 'amber' | 'red';
}) {
  const toneClass =
    tone === 'emerald' ? 'text-emerald-300' :
    tone === 'amber'   ? 'text-amber-300'   :
    tone === 'red'     ? 'text-red-300'     : 'text-slate-100';
  return (
    <div className="rounded-lg border border-slate-800 bg-[#0F1320] px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`mt-0.5 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
