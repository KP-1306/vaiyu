// web/src/routes/owner/Assets.tsx
//
// Digital Asset Manager workspace — Position 6 of the growth sheet.
// Light theme, mobile-first, owner-facing.

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Camera, ChevronLeft, Languages, Loader2 } from 'lucide-react';

import { supabase } from '../../lib/supabase';
import {
  DIGITAL_ASSET_MANAGER_V0_ENABLED,
  DAM_CATEGORY_LABELS,
  DAM_COPY,
} from '../../config/digitalAssetManager';
import { listAssetStatus } from '../../services/digitalAssetService';
import type { AssetCategory, AssetStatusRow } from '../../types/digitalAssets';

import { AssetCategorySection } from '../../components/assets/AssetCategorySection';
import {
  PrivacyDisclaimerBanner,
  HinglishOnboardingHelper,
} from '../../components/assets/PrivacyDisclaimerBanner';
import { useOwnerT, useOwnerLang } from '../../i18n/useOwnerT';

interface Hotel { id: string; name: string; slug: string; }

const CATEGORY_ORDER: AssetCategory[] = [
  'VERIFICATION_PROOF',
  'TRUST_ESSENTIALS',
  'OPERATIONAL',
  'EXPERIENCE',
];

export default function Assets() {
  const { slug: rawSlug } = useParams();
  const slug = (rawSlug ?? '').trim();
  const t = useOwnerT('owner-assets');
  const ownerLang = useOwnerLang();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [hotelLoading, setHotelLoading] = useState(true);
  const [showHinglish, setShowHinglish] = useState(false);

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

  const statusQ = useQuery({
    queryKey: ['asset-status', hotel?.id],
    queryFn: () => listAssetStatus(hotel!.id),
    enabled: !!hotel?.id,
    staleTime: 10_000,
  });

  const rows: AssetStatusRow[] = statusQ.data ?? [];
  // Bilingual data fields show automatically when owner UI is Hindi (reveal-gate ON),
  // OR when the explicit Hinglish toggle is on.
  const showBilingual = ownerLang === 'hi' || showHinglish;

  const byCategory = useMemo(() => {
    const map = new Map<AssetCategory, AssetStatusRow[]>();
    for (const c of CATEGORY_ORDER) map.set(c, []);
    for (const r of rows) {
      const list = map.get(r.category);
      if (list) list.push(r);
    }
    return map;
  }, [rows]);

  const summary = useMemo(() => summarise(rows), [rows]);

  if (!DIGITAL_ASSET_MANAGER_V0_ENABLED) {
    return (
      <main className="vaiyu-owner mx-auto max-w-3xl px-4 py-10 text-slate-600">
        <p className="rounded-md border border-slate-200 bg-white px-4 py-3 text-[13px]">
          {t('state.notEnabled', 'Digital Asset Manager is currently disabled.')}
        </p>
      </main>
    );
  }

  if (hotelLoading) {
    return (
      <main className="vaiyu-owner mx-auto flex max-w-6xl items-center gap-2 px-4 py-10 text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('state.loading', 'Loading…')}
      </main>
    );
  }

  if (!hotel) {
    return (
      <main className="vaiyu-owner mx-auto max-w-3xl px-4 py-10 text-slate-600">
        <p className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
          {t('state.notFound', 'Hotel not found.')}
        </p>
      </main>
    );
  }

  const pct = summary.total === 0 ? 0 : Math.round((summary.ready / summary.total) * 100);

  return (
    <main className="vaiyu-owner min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-3 py-5 sm:px-4 sm:py-6">
        <div className="mb-3 flex items-center justify-between text-[11px] text-slate-500">
          <Link
            to={`/owner/${hotel.slug}`}
            className="inline-flex items-center gap-1 hover:text-slate-700"
            data-testid="assets-back"
          >
            <ChevronLeft className="h-3 w-3" aria-hidden /> {t('nav.back', 'Back to dashboard')}
          </Link>
          <button
            type="button"
            onClick={() => setShowHinglish((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
              showHinglish
                ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
            }`}
            aria-pressed={showHinglish}
          >
            <Languages className="h-3 w-3" aria-hidden />
            {showHinglish ? t('action.hideHinglish', 'Hide Hinglish') : t('action.showHinglish', 'Show Hinglish')}
          </button>
        </div>

        <header className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-fuchsia-100 text-fuchsia-700">
                <Camera className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-fuchsia-700">
                  {t('page.workspaceLabel', 'Asset Readiness Workspace')}
                </p>
                <h1 className="mt-0.5 truncate text-lg font-semibold text-slate-900 sm:text-xl">
                  {hotel.name}
                </h1>
              </div>
            </div>
            <ReadinessRing pct={pct} ready={summary.ready} total={summary.total} />
          </div>
          <div className="grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-4">
            {CATEGORY_ORDER.map((c) => {
              const list = byCategory.get(c) ?? [];
              const r = list.filter((x) => x.status === 'COLLECTED' || x.status === 'APPROVED').length;
              const total = list.length;
              return (
                <div key={c} className="bg-white px-3 py-2.5 text-center">
                  <div className="text-[9.5px] font-bold uppercase tracking-wider text-slate-500">
                    {t(`category.${c}`, DAM_CATEGORY_LABELS[c])}
                  </div>
                  <div className="mt-0.5 text-base font-semibold text-slate-900">
                    {r}<span className="text-slate-400">/{total}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </header>

        <section className="mt-4 space-y-3">
          <PrivacyDisclaimerBanner />
          <HinglishOnboardingHelper />
        </section>

        <section className="mt-4 space-y-3">
          {statusQ.isLoading && (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[13px] text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('state.loadingAssets', 'Loading assets…')}
            </div>
          )}
          {!statusQ.isLoading && CATEGORY_ORDER.map((c) => {
            const list = (byCategory.get(c) ?? []).slice()
              .sort((a, b) => (a.priority_rank - b.priority_rank) || (a.sort_order - b.sort_order));
            const allReady = list.length > 0 && list.every((r) => r.status === 'COLLECTED' || r.status === 'APPROVED');
            return (
              <AssetCategorySection
                key={c}
                category={c}
                rows={list}
                defaultOpen={!allReady}
                showHinglish={showBilingual}
              />
            );
          })}
        </section>

        <footer className="mx-auto mt-6 max-w-3xl text-center">
          <p className="text-[11px] text-slate-500">{DAM_COPY.disclaimerEN}</p>
          <p className="mt-1 text-[10.5px] text-slate-400">{DAM_COPY.disclaimerHI}</p>
        </footer>
      </div>
    </main>
  );
}

function summarise(rows: AssetStatusRow[]) {
  const total = rows.length;
  let ready = 0, missing = 0, replacement = 0, approved = 0;
  for (const r of rows) {
    if (r.status === 'COLLECTED' || r.status === 'APPROVED') ready++;
    if (r.status === 'APPROVED') approved++;
    if (r.status === 'MISSING') missing++;
    if (r.status === 'REJECTED' || r.status === 'NEEDS_REPLACEMENT') replacement++;
  }
  return { total, ready, missing, replacement, approved };
}

function ReadinessRing({ pct, ready, total }: { pct: number; ready: number; total: number }) {
  const t = useOwnerT('owner-assets');
  const radius = 28;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (pct / 100) * circ;
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-16 w-16">
        <svg viewBox="0 0 80 80" className="h-16 w-16 -rotate-90">
          <circle cx="40" cy="40" r={radius} className="fill-none stroke-slate-200" strokeWidth="8" />
          <circle
            cx="40"
            cy="40"
            r={radius}
            className="fill-none stroke-fuchsia-500 transition-all duration-700"
            strokeWidth="8"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-[13px] font-semibold text-slate-900">
          {pct}%
        </div>
      </div>
      <div className="text-right">
        <div className="text-[10.5px] font-bold uppercase tracking-widest text-slate-500">{t('readyLabel', 'Ready')}</div>
        <div className="text-base font-semibold text-slate-900">
          {ready}<span className="text-slate-400">/{total}</span>
        </div>
      </div>
    </div>
  );
}
