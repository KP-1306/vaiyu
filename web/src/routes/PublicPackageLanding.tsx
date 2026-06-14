// web/src/routes/PublicPackageLanding.tsx
//
// Public, anonymous-friendly landing page for an active+approved package.
// Path:  /p/:hotelSlug/package/:packageSlug
// Theme: LIGHT (guest-facing). Owner surfaces stay dark.

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, ArrowRight, Info } from 'lucide-react';
import { getPackagePublic, trackPackageView } from '../services/packageService';
import { packageQueryKeys } from '../services/packageQueryKeys';
import { PACKAGE_DISCLAIMER } from '../config/packages';
import { PackageLandingHero } from '../components/packages/PackageLandingHero';
import { PackageLandingInclusions } from '../components/packages/PackageLandingInclusions';
import SEO from '../components/SEO';

export default function PublicPackageLanding() {
  const { t, i18n } = useTranslation('publicEnquiry');
  const dateLocale = i18n.language?.split('-')[0] === 'hi' ? 'hi-IN-u-nu-latn' : 'en-IN';
  const { hotelSlug, packageSlug } = useParams<{ hotelSlug: string; packageSlug: string }>();
  const [searchParams] = useSearchParams();
  const isPreview = searchParams.get('preview') === '1';
  const utmSource = searchParams.get('utm_source');

  const { data, isLoading, isError } = useQuery({
    queryKey: hotelSlug && packageSlug
      ? packageQueryKeys.publicLanding(hotelSlug, packageSlug)
      : ['package-public', 'noop'],
    queryFn: () => (hotelSlug && packageSlug ? getPackagePublic(hotelSlug, packageSlug) : Promise.resolve(null)),
    enabled: !!hotelSlug && !!packageSlug,
    staleTime: 60_000,
  });

  // Fire-and-forget analytics view (skip during owner preview).
  useEffect(() => {
    if (isPreview) return;
    if (!data?.package?.id) return;
    void trackPackageView({
      packageId: data.package.id,
      source: utmSource ?? (document.referrer ? 'referral' : 'direct'),
      referrer: document.referrer || undefined,
    });
  }, [data?.package?.id, isPreview, utmSource]);

  const enquireHref = useMemo(() => {
    if (!hotelSlug || !data?.package?.slug) return null;
    const params = new URLSearchParams();
    params.set('package', data.package.slug);
    if (utmSource) params.set('utm_source', utmSource);
    return `/p/${hotelSlug}/enquire?${params.toString()}`;
  }, [hotelSlug, data?.package?.slug, utmSource]);

  if (isLoading) {
    return (
      <main className="min-h-screen grid place-items-center bg-slate-50">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden />
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="min-h-screen grid place-items-center bg-slate-50">
        <div className="max-w-md text-center space-y-3 px-4">
          <h1 className="text-xl font-semibold text-slate-800">{t('pkgNotAvailable')}</h1>
          <p className="text-sm text-slate-500">
            {t('pkgNotAvailableBody')}
          </p>
          {hotelSlug && (
            <Link
              to={`/p/${hotelSlug}/enquire`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            >
              {t('sendEnquiryLink')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
        </div>
      </main>
    );
  }

  const { package: pkg, hotel } = data;
  const metaDescription = pkg.short_pitch
    ?? `${pkg.duration_nights}-night ${hotel.name} package${hotel.city ? ` in ${hotel.city}` : ''}. ${pkg.starting_price_text}.`;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <SEO
        title={`${pkg.name} · ${hotel.name}`}
        description={metaDescription}
        canonical={hotelSlug && packageSlug ? `${window.location.origin}/p/${hotelSlug}/package/${packageSlug}` : undefined}
        ogImage={pkg.hero_image_url ?? undefined}
        noIndex={isPreview}
      />
      {isPreview && (
        <div className="bg-amber-100 border-b border-amber-200 text-amber-900 px-4 py-2 text-xs sm:text-sm text-center">
          <Info className="inline h-3.5 w-3.5 mr-1 -mt-0.5" aria-hidden />
          {t('previewMode')}
        </div>
      )}
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-10 space-y-5">
        <PackageLandingHero payload={data} />

        {pkg.long_description && (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-base font-semibold text-slate-900 mb-3">{t('aboutExperience')}</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
              {pkg.long_description}
            </p>
          </section>
        )}

        <PackageLandingInclusions payload={data} />

        {/* Stay shape */}
        <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
          <h2 className="text-base font-semibold text-slate-900 mb-3">{t('stayDetailsTitle')}</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">{t('duration')}</dt>
              <dd className="mt-0.5 text-slate-800">
                {t('nights', { count: pkg.duration_nights })}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">{t('partySize')}</dt>
              <dd className="mt-0.5 text-slate-800">
                {pkg.min_party_adults}
                {pkg.max_party_adults && pkg.max_party_adults > pkg.min_party_adults
                  ? `–${pkg.max_party_adults}`
                  : '+'}{' '}
                {t('adultsWord', { count: pkg.min_party_adults === 1 && pkg.max_party_adults === 1 ? 1 : 2 })}
              </dd>
            </div>
            {pkg.target_guest_type && (
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-slate-500">{t('idealFor')}</dt>
                <dd className="mt-0.5 text-slate-800">{pkg.target_guest_type}</dd>
              </div>
            )}
            {(pkg.valid_from || pkg.valid_until) && (
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-slate-500">{t('validityWindow')}</dt>
                <dd className="mt-0.5 text-slate-800">
                  {pkg.valid_from ? new Date(pkg.valid_from).toLocaleDateString(dateLocale) : '—'}
                  {' to '}
                  {pkg.valid_until ? new Date(pkg.valid_until).toLocaleDateString(dateLocale) : '—'}
                </dd>
              </div>
            )}
          </dl>
        </section>

        {/* Pricing + Enquire CTA */}
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50/40 p-6 sm:p-8">
          <p className="text-xs uppercase tracking-wide text-emerald-700 font-semibold">{t('pricing')}</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{pkg.starting_price_text}</p>
          <p className="mt-3 text-xs text-slate-600">
            {t('finalRate', { hotel: hotel.name })}
          </p>
          {enquireHref && (
            <Link
              to={enquireHref}
              className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
              data-testid="package-enquire-cta"
            >
              {pkg.enquiry_cta_label || t('enquireNow')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
        </section>

        {/* Disclaimer */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500 leading-relaxed">
          <p>{PACKAGE_DISCLAIMER}</p>
        </section>

        <footer className="pt-2 pb-6 text-center text-xs text-slate-400">
          {t('poweredBy')}
        </footer>
      </div>
    </main>
  );
}
