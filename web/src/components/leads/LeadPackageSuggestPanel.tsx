// web/src/components/leads/LeadPackageSuggestPanel.tsx
//
// Surfaces up to 3 best-fit Experience Packages for a given lead based on
// party size + check-in month + party-type signal in source_detail/tags.
// Operator can copy the public landing URL to clipboard (for WhatsApp) or
// open the package directly.
//
// Embedded inside LeadDetailDrawer, below the basics section.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, Copy, ExternalLink, Tent } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { listActivePackages } from '../../services/packageService';
import { packageQueryKeys } from '../../services/packageQueryKeys';
import {
  PACKAGE_BUILDER_V0_ENABLED,
  PACKAGE_CATEGORY_LABEL,
  seasonMatches,
} from '../../config/packages';
import type { Package, PackageCategory } from '../../types/package';
import type { Lead } from '../../types/lead';

interface Props {
  lead: Lead;
}

interface HotelRow { id: string; slug: string }

interface ScoredPackage {
  pkg: Package;
  score: number;
  reasons: string[];
}

/** Heuristic scoring — returns 0+ score with reason strings. */
function scorePackageForLead(pkg: Package, lead: Lead): ScoredPackage {
  const reasons: string[] = [];
  let score = 0;

  // Party size match
  const adults = lead.party_adults ?? 0;
  if (adults >= pkg.min_party_adults && (pkg.max_party_adults == null || adults <= pkg.max_party_adults)) {
    score += 3;
    reasons.push(`Fits party (${adults} adults)`);
  } else if (adults > 0 && adults < pkg.min_party_adults) {
    score -= 1;
  }

  // Season match against requested check-in month
  if (lead.requested_check_in) {
    const checkInMonth = new Date(lead.requested_check_in).getMonth() + 1;
    if (Number.isFinite(checkInMonth) && seasonMatches(pkg.season_months, new Date(lead.requested_check_in))) {
      score += 3;
      reasons.push('In season for the requested dates');
    } else if (pkg.season_months.length > 0 && pkg.season_months.length < 12) {
      // Out of season — penalty
      score -= 2;
    }
  } else {
    // No dates → small bonus if package is year-round
    if (pkg.season_months.length === 0 || pkg.season_months.length === 12) {
      score += 1;
    }
  }

  // Children → favour FAMILY_STAY
  if ((lead.party_children ?? 0) > 0 && pkg.category === 'FAMILY_STAY') {
    score += 2;
    reasons.push('Family stay (kids in party)');
  }

  // Couple signal — 2 adults, 0 kids, 1 room → favour couple retreats
  if (adults === 2 && (lead.party_children ?? 0) === 0 && (lead.room_count ?? 1) === 1
      && pkg.category === 'COUPLE_RETREAT') {
    score += 2;
    reasons.push('Looks like a couple booking');
  }

  // Category tag/keyword hints from source_detail or tags
  const haystack = [
    lead.source_detail ?? '',
    ...(lead.tags ?? []),
  ].join(' ').toLowerCase();
  const categoryKeywords: Record<PackageCategory, string[]> = {
    WEEKEND_ESCAPE: ['weekend', 'shortstay', 'short stay'],
    ADVENTURE_TREKKING: ['trek', 'adventure', 'rafting', 'hike'],
    RELIGIOUS_SPIRITUAL: ['char dham', 'yatra', 'temple', 'spiritual', 'religious'],
    WELLNESS_YOGA: ['yoga', 'wellness', 'meditation', 'detox', 'retreat'],
    WORKATION_MONSOON: ['workation', 'remote', 'monsoon'],
    FAMILY_STAY: ['family', 'kids', 'children'],
    COUPLE_RETREAT: ['honeymoon', 'anniversary', 'couple', 'romantic'],
    CUSTOM: [],
  };
  const matched = categoryKeywords[pkg.category].some((kw) => haystack.includes(kw));
  if (matched) {
    score += 2;
    reasons.push(`Matches "${PACKAGE_CATEGORY_LABEL[pkg.category]}" keywords`);
  }

  return { pkg, score, reasons };
}

export function LeadPackageSuggestPanel({ lead }: Props) {
  if (!PACKAGE_BUILDER_V0_ENABLED) return null;

  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const hotelQ = useQuery<HotelRow | null>({
    queryKey: ['lead-suggest-hotel', lead.hotel_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hotels')
        .select('id, slug')
        .eq('id', lead.hotel_id)
        .maybeSingle();
      if (error) throw error;
      return data as HotelRow | null;
    },
    staleTime: 60_000,
  });

  const pkgQ = useQuery({
    queryKey: packageQueryKeys.active(lead.hotel_id),
    queryFn: () => listActivePackages(lead.hotel_id),
    staleTime: 30_000,
  });

  const top3 = useMemo<ScoredPackage[]>(() => {
    const all = (pkgQ.data ?? [])
      .map((p) => scorePackageForLead(p, lead))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
    return all.slice(0, 3);
  }, [pkgQ.data, lead]);

  async function copyUrl(slug: string) {
    if (!hotelQ.data?.slug) return;
    const url = `${window.location.origin}/p/${hotelQ.data.slug}/package/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedSlug(slug);
      window.setTimeout(() => setCopiedSlug((c) => (c === slug ? null : c)), 1500);
    } catch {
      // Fallback for browsers that block clipboard API
      window.prompt('Copy this URL', url);
    }
  }

  // Hide the panel cleanly when there are no published packages to suggest.
  if (pkgQ.isLoading || !hotelQ.data) return null;
  if ((pkgQ.data ?? []).length === 0) return null;

  return (
    <section
      className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3"
      data-testid="lead-package-suggest-panel"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-100 inline-flex items-center gap-2">
          <Tent className="h-4 w-4 text-emerald-300" aria-hidden />
          Suggested packages
        </h3>
        <Link
          to={`/owner/${hotelQ.data.slug}/packages`}
          className="text-[11px] text-slate-400 hover:text-slate-200"
        >
          Manage all →
        </Link>
      </div>

      {top3.length === 0 ? (
        <p className="text-[11px] text-slate-500">
          No packages match this lead's party / season profile. Try editing the lead basics or build a matching package.
        </p>
      ) : (
        <ul className="space-y-2">
          {top3.map(({ pkg, reasons }) => (
            <li
              key={pkg.id}
              className="rounded-lg border border-slate-800 bg-[#0B0E14] p-3 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-100 truncate">{pkg.name}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {PACKAGE_CATEGORY_LABEL[pkg.category]} · {pkg.duration_nights} night{pkg.duration_nights === 1 ? '' : 's'} · {pkg.starting_price_text}
                  </p>
                </div>
              </div>
              {reasons.length > 0 && (
                <ul className="text-[10px] text-emerald-200/80 space-y-0.5">
                  {reasons.map((r, i) => (
                    <li key={i}>· {r}</li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => copyUrl(pkg.slug)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
                  data-testid={`lead-suggest-copy-${pkg.slug}`}
                >
                  {copiedSlug === pkg.slug ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-300" aria-hidden />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" aria-hidden />
                      Copy URL
                    </>
                  )}
                </button>
                <Link
                  to={`/p/${hotelQ.data!.slug}/package/${pkg.slug}?preview=1`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
                >
                  <ExternalLink className="h-3 w-3" aria-hidden />
                  Open
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[10px] text-slate-500">
        Pick a package, copy the link, share via WhatsApp. Final price confirmed by staff.
      </p>
    </section>
  );
}
