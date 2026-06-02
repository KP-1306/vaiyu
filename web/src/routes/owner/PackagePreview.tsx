// web/src/routes/owner/PackagePreview.tsx
//
// /owner/:slug/packages/:id/preview
// Renders the public landing layout for a package even when it is DRAFT /
// READY / PAUSED / CHANGES_REQUESTED — so managers can verify the page before
// approving + publishing. Uses an RLS-scoped read (not the anon RPC), so only
// hotel members can hit this route.

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getPackage } from '../../services/packageService';
import { packageQueryKeys } from '../../services/packageQueryKeys';
import type { PublicPackagePayload } from '../../types/package';
import { PACKAGE_DISCLAIMER, PACKAGE_STATUS_LABEL, PACKAGE_APPROVAL_LABEL } from '../../config/packages';
import { PackageLandingHero } from '../../components/packages/PackageLandingHero';
import { PackageLandingInclusions } from '../../components/packages/PackageLandingInclusions';

interface HotelRow {
  id: string;
  name: string;
  slug: string;
  city: string | null;
}

export default function PackagePreview() {
  const { slug, id } = useParams<{ slug: string; id: string }>();

  const pkgQ = useQuery({
    queryKey: id ? packageQueryKeys.detail(id) : ['package', 'noop'],
    queryFn: () => (id ? getPackage(id) : Promise.resolve(null)),
    enabled: !!id,
    staleTime: 15_000,
  });

  const hotelQ = useQuery<HotelRow | null>({
    queryKey: ['preview-hotel', slug],
    queryFn: async () => {
      if (!slug) return null;
      const { data, error } = await supabase
        .from('hotels')
        .select('id, name, slug, city')
        .eq('slug', slug)
        .maybeSingle();
      if (error) throw error;
      return data as HotelRow | null;
    },
    enabled: !!slug,
    staleTime: 60_000,
  });

  // Track scroll-to-top on mount
  useEffect(() => { window.scrollTo(0, 0); }, []);

  const payload: PublicPackagePayload | null = useMemo(() => {
    if (!pkgQ.data || !hotelQ.data) return null;
    const p = pkgQ.data;
    return {
      package: {
        id: p.id,
        slug: p.slug,
        name: p.name,
        category: p.category,
        target_guest_type: p.target_guest_type,
        hero_image_url: p.hero_image_url,
        short_pitch: p.short_pitch,
        long_description: p.long_description,
        duration_nights: p.duration_nights,
        min_party_adults: p.min_party_adults,
        max_party_adults: p.max_party_adults,
        season_months: p.season_months,
        valid_from: p.valid_from,
        valid_until: p.valid_until,
        food_inclusions: p.food_inclusions,
        activity_inclusions: p.activity_inclusions,
        transfer_inclusions: p.transfer_inclusions,
        custom_inclusions: p.custom_inclusions,
        starting_price_text: p.starting_price_text,
        enquiry_cta_label: p.enquiry_cta_label,
      },
      hotel: {
        id: hotelQ.data.id,
        name: hotelQ.data.name,
        city: hotelQ.data.city,
        slug: hotelQ.data.slug,
      },
    };
  }, [pkgQ.data, hotelQ.data]);

  if (pkgQ.isLoading || hotelQ.isLoading) {
    return (
      <main className="min-h-screen grid place-items-center bg-slate-50">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden />
      </main>
    );
  }

  if (!payload || !pkgQ.data || !hotelQ.data) {
    return (
      <main className="min-h-screen grid place-items-center bg-slate-50">
        <div className="text-center space-y-2">
          <p className="text-sm text-slate-600">Package not found.</p>
          {slug && (
            <Link
              to={`/owner/${slug}/packages`}
              className="text-xs text-emerald-700 hover:underline"
            >
              Back to packages
            </Link>
          )}
        </div>
      </main>
    );
  }

  const pkg = pkgQ.data;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {/* Preview chrome bar */}
      <div className="sticky top-0 z-10 border-b border-amber-200 bg-amber-100 text-amber-900">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 text-xs sm:text-sm">
          <div className="flex items-center gap-2 min-w-0">
            <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              Preview — <strong>{pkg.name}</strong> · {PACKAGE_STATUS_LABEL[pkg.status]} ·{' '}
              {PACKAGE_APPROVAL_LABEL[pkg.owner_approval_status]}
            </span>
          </div>
          <Link
            to={`/owner/${slug}/packages/${pkg.id}`}
            className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white/60 px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-white"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden />
            Back to editor
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-10 space-y-5">
        <PackageLandingHero payload={payload} />

        {pkg.long_description && (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-base font-semibold text-slate-900 mb-3">About this experience</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
              {pkg.long_description}
            </p>
          </section>
        )}

        <PackageLandingInclusions payload={payload} />

        <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
          <h2 className="text-base font-semibold text-slate-900 mb-3">Stay details</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Duration</dt>
              <dd className="mt-0.5 text-slate-800">
                {pkg.duration_nights} night{pkg.duration_nights === 1 ? '' : 's'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Party size</dt>
              <dd className="mt-0.5 text-slate-800">
                {pkg.min_party_adults}
                {pkg.max_party_adults && pkg.max_party_adults > pkg.min_party_adults
                  ? `–${pkg.max_party_adults}`
                  : '+'}{' '}
                adults
              </dd>
            </div>
            {pkg.target_guest_type && (
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-slate-500">Ideal for</dt>
                <dd className="mt-0.5 text-slate-800">{pkg.target_guest_type}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="rounded-3xl border border-emerald-200 bg-emerald-50/40 p-6 sm:p-8">
          <p className="text-xs uppercase tracking-wide text-emerald-700 font-semibold">Pricing</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{pkg.starting_price_text}</p>
          <p className="mt-3 text-xs text-slate-600">
            Final rate confirmed by {hotelQ.data.name} after enquiry.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500 leading-relaxed">
          <p>{PACKAGE_DISCLAIMER}</p>
        </section>
      </div>
    </main>
  );
}
