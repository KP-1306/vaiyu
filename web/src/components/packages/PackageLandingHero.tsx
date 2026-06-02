// web/src/components/packages/PackageLandingHero.tsx
//
// Hero for the public landing page. Light theme (guest-facing context).

import type { PublicPackagePayload } from '../../types/package';
import {
  PACKAGE_CATEGORY_LABEL,
  monthsToLabel,
} from '../../config/packages';

interface Props {
  payload: PublicPackagePayload;
}

export function PackageLandingHero({ payload }: Props) {
  const { package: pkg, hotel } = payload;
  const monthsLabel = monthsToLabel(pkg.season_months);

  return (
    <header className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
      {pkg.hero_image_url && (
        <div className="aspect-[16/9] w-full bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pkg.hero_image_url}
            alt={pkg.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      )}
      <div className="p-6 sm:p-8 space-y-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
            {PACKAGE_CATEGORY_LABEL[pkg.category]}
          </span>
          <span className="text-slate-500">{pkg.duration_nights} night{pkg.duration_nights === 1 ? '' : 's'}</span>
          <span className="text-slate-300">·</span>
          <span className="text-slate-500">{monthsLabel}</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900">{pkg.name}</h1>
        <p className="text-sm text-slate-500">
          {hotel.name}{hotel.city ? `, ${hotel.city}` : ''}
        </p>
        {pkg.short_pitch && (
          <p className="text-base text-slate-700 leading-relaxed">{pkg.short_pitch}</p>
        )}
      </div>
    </header>
  );
}
