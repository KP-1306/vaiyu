// web/src/routes/owner/SeasonalCalendar.tsx
//
// Seasonal Demand Calendar workspace — Position 8 of the growth sheet.
// Light theme, mobile-first, owner-facing.
//
// Layout:
//   • Header (hotel + summary counters)
//   • Disclaimer banner (verbatim PO copy)
//   • Top 3 next-focus highlight cards (sorted by urgency + days)
//   • 8 category sections (collapsible)
//   • Dismissed / Hidden tab (rendered as a separate accordion at bottom)

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, Languages, Loader2, Flame } from 'lucide-react';

import { supabase } from '../../lib/supabase';
import {
  SEASONAL_DEMAND_CALENDAR_V0_ENABLED,
  SEASONAL_DISCLAIMER_EN,
  SEASONAL_DISCLAIMER_HI,
  SEASONAL_CATEGORY_ORDER,
  formatDaysUntil,
} from '../../config/seasonalCalendar';
import {
  listVisibleSeasonalWindows,
  summarizeSeasonalCalendar,
} from '../../services/seasonalCalendarService';
import { seasonalCalendarQueryKeys } from '../../services/seasonalCalendarQueryKeys';
import { useSeasonalWindowsRealtime } from '../../hooks/useSeasonalWindowsRealtime';
import type {
  SeasonalCategory,
  VisibleSeasonalWindow,
} from '../../types/seasonalCalendar';
import { useOwnerT, useOwnerLang } from '../../i18n/useOwnerT';

import { SeasonalDisclaimerBanner } from '../../components/seasonal/SeasonalDisclaimerBanner';
import { SeasonalCategorySection } from '../../components/seasonal/SeasonalCategorySection';
import { SeasonalWindowCard } from '../../components/seasonal/SeasonalWindowCard';

interface Hotel { id: string; name: string; slug: string; state: string | null }

export default function SeasonalCalendar() {
  const { slug: rawSlug } = useParams();
  const slug = (rawSlug ?? '').trim();
  const t = useOwnerT('owner-seasonal');
  const ownerLang = useOwnerLang();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [hotelLoading, setHotelLoading] = useState(true);
  const [showHinglish, setShowHinglish] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchHotel() {
      setHotelLoading(true);
      const { data } = await supabase
        .from('hotels')
        .select('id, name, slug, state')
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

  useSeasonalWindowsRealtime(hotel?.id ?? undefined);

  const listQ = useQuery({
    queryKey: hotel?.id
      ? seasonalCalendarQueryKeys.list(hotel.id)
      : ['seasonal-windows', 'noop'],
    queryFn: () => (hotel?.id ? listVisibleSeasonalWindows(hotel.id, { includeHidden: true }) : Promise.resolve([])),
    enabled: !!hotel?.id,
    staleTime: 15_000,
  });

  // Bilingual catalog data field selection. When owner UI is Hindi (reveal-gate ON
  // + lang=hi) OR the explicit Hinglish toggle is on, pick the *_hi data fields.
  const language: 'en' | 'hi' = ownerLang === 'hi' || showHinglish ? 'hi' : 'en';
  const allWindows: VisibleSeasonalWindow[] = listQ.data ?? [];
  const visibleWindows = useMemo(() => allWindows.filter((w) => !w.is_permanently_hidden), [allWindows]);
  const hiddenWindows = useMemo(() => allWindows.filter((w) => w.is_permanently_hidden), [allWindows]);

  const summary = useMemo(() => summarizeSeasonalCalendar(visibleWindows), [visibleWindows]);

  const byCategory = useMemo(() => {
    const map = new Map<SeasonalCategory, VisibleSeasonalWindow[]>();
    for (const c of SEASONAL_CATEGORY_ORDER) map.set(c, []);
    for (const w of visibleWindows) {
      const list = map.get(w.category);
      if (list) list.push(w);
    }
    return map;
  }, [visibleWindows]);

  const top3 = useMemo(
    () =>
      visibleWindows
        .filter((w) => w.review_status !== 'DISMISSED')
        .sort((a, b) => {
          const urgencyRank: Record<string, number> = { NOW: 0, PREPARE: 1, WATCH: 2, QUIET: 3 };
          const ru = urgencyRank[a.computed_urgency] - urgencyRank[b.computed_urgency];
          if (ru !== 0) return ru;
          return a.days_to_start - b.days_to_start;
        })
        .slice(0, 3),
    [visibleWindows],
  );

  if (!SEASONAL_DEMAND_CALENDAR_V0_ENABLED) {
    return (
      <main className="vaiyu-owner mx-auto max-w-3xl px-4 py-10 text-slate-600">
        <p className="rounded-md border border-slate-200 bg-white px-4 py-3 text-[13px]">
          {t('state.notEnabled', 'Seasonal Demand Calendar is currently disabled.')}
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

  return (
    <main className="vaiyu-owner min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-3 py-5 sm:px-4 sm:py-6">
        <div className="mb-3 flex items-center justify-between text-[11px] text-slate-500">
          <Link
            to={`/owner/${hotel.slug}`}
            className="inline-flex items-center gap-1 hover:text-slate-700"
            data-testid="seasonal-back"
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

        {/* Header */}
        <header className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
                <CalendarDays className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
                  {t('page.workspaceLabel', 'Seasonal Planning Workspace')}
                </p>
                <h1 className="mt-0.5 truncate text-lg font-semibold text-slate-900 sm:text-xl">
                  {hotel.name}
                </h1>
                {hotel.state && (
                  <p className="text-[11px] text-slate-500">{t('page.regionLabel', 'Region: {{state}}', { state: hotel.state })}</p>
                )}
              </div>
            </div>
            <SummaryRing summary={summary} />
          </div>
          <div className="grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-4">
            <SummaryStat label={t('summary.now', 'Now')}         value={summary.byUrgency.NOW ?? 0}      tone="rose" />
            <SummaryStat label={t('summary.prepare', 'Prepare')} value={summary.byUrgency.PREPARE ?? 0}  tone="amber" />
            <SummaryStat label={t('summary.watch', 'Watch')}     value={summary.byUrgency.WATCH ?? 0}    tone="sky" />
            <SummaryStat label={t('summary.ready', 'Ready')}     value={summary.byReviewStatus.READY ?? 0} tone="emerald" />
          </div>
        </header>

        {/* Disclaimer */}
        <section className="mt-4">
          <SeasonalDisclaimerBanner />
        </section>

        {/* Top 3 next-focus */}
        {!listQ.isLoading && top3.length > 0 && (
          <section className="mt-4">
            <div className="mb-2 flex items-center gap-1.5">
              <Flame className="h-3.5 w-3.5 text-rose-500" aria-hidden />
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-600">
                {t('top3.title', 'Next 3 to focus on')}
              </h2>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {top3.map((w) => (
                <button
                  key={w.window_code}
                  type="button"
                  onClick={() => {
                    const el = document.getElementById(w.window_code);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="block w-full text-left rounded-lg border border-slate-200 bg-white p-3 hover:border-emerald-300"
                >
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    {t(`urgency.${w.computed_urgency}`, w.computed_urgency)}
                  </div>
                  <div className="mt-0.5 truncate text-[13.5px] font-semibold text-slate-900">
                    {language === 'hi' ? w.display_name_hi : w.display_name_en}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {formatDaysUntil(w.days_to_start, w.computed_urgency, t)} · {t('top3.prepProgress', '{{done}}/{{total}} prep done', { done: w.checklist_done, total: w.checklist_total })}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Category sections */}
        <section className="mt-4 space-y-3">
          {listQ.isLoading && (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[13px] text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('state.loadingWindows', 'Loading planning windows…')}
            </div>
          )}
          {listQ.isError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">
              {t('state.loadError', 'Could not load planning windows.')}{' '}
              <button
                type="button"
                onClick={() => listQ.refetch()}
                className="underline hover:no-underline"
              >
                {t('state.retry', 'Retry')}
              </button>
            </div>
          )}
          {!listQ.isLoading && !listQ.isError && SEASONAL_CATEGORY_ORDER.map((c) => {
            const list = (byCategory.get(c) ?? []).slice().sort((a, b) => a.display_order - b.display_order);
            const hasUrgent = list.some(
              (w) => w.computed_urgency === 'NOW' && w.review_status !== 'DISMISSED',
            );
            return (
              <SeasonalCategorySection
                key={c}
                hotelId={hotel.id}
                hotelSlug={hotel.slug}
                category={c}
                windows={list}
                language={language}
                defaultOpen={hasUrgent || list.length <= 3}
              />
            );
          })}
        </section>

        {/* Hidden windows (separate accordion) */}
        {hiddenWindows.length > 0 && (
          <section className="mt-4">
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left text-[12px] text-slate-700 hover:bg-slate-50"
            >
              <span>{t('state.hiddenAccordion', 'Permanently hidden ({{count}})', { count: hiddenWindows.length })}</span>
              <span className="text-slate-400">{showHidden ? '−' : '+'}</span>
            </button>
            {showHidden && (
              <div className="mt-2 space-y-3">
                {hiddenWindows.map((w) => (
                  <SeasonalWindowCard
                    key={w.window_code}
                    hotelId={hotel.id}
                    hotelSlug={hotel.slug}
                    window={w}
                    language={language}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Footer disclaimer */}
        <footer className="mx-auto mt-6 max-w-3xl text-center">
          <p className="text-[11px] text-slate-500">{SEASONAL_DISCLAIMER_EN}</p>
          <p className="mt-1 text-[10.5px] text-slate-400">{SEASONAL_DISCLAIMER_HI}</p>
        </footer>
      </div>
    </main>
  );
}

function SummaryRing({ summary }: { summary: ReturnType<typeof summarizeSeasonalCalendar> }) {
  const t = useOwnerT('owner-seasonal');
  const total = summary.total;
  const ready = summary.byReviewStatus.READY ?? 0;
  const pct = total === 0 ? 0 : Math.round((ready / total) * 100);
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
            className="fill-none stroke-emerald-500 transition-all duration-700"
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
        <div className="text-[10.5px] font-bold uppercase tracking-widest text-slate-500">{t('summary.readyLabel', 'Ready')}</div>
        <div className="text-base font-semibold text-slate-900">
          {ready}<span className="text-slate-400">/{total}</span>
        </div>
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'rose' | 'amber' | 'sky' | 'emerald';
}) {
  const colour =
    tone === 'rose'    ? 'text-rose-700' :
    tone === 'amber'   ? 'text-amber-700' :
    tone === 'sky'     ? 'text-sky-700'   :
                         'text-emerald-700';
  return (
    <div className="bg-white px-3 py-2.5 text-center">
      <div className="text-[9.5px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-0.5 text-base font-semibold ${colour}`}>{value}</div>
    </div>
  );
}
