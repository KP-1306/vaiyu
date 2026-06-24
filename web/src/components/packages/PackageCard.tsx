// web/src/components/packages/PackageCard.tsx
//
// Card row in the workspace list. Click → edit; menu opens row actions.

import { Calendar, Eye, MoreHorizontal, Pencil } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Package } from '../../types/package';
import { monthsToLabel } from '../../config/packages';
import { PackageStatusPill, PackageApprovalPill } from './PackageStatusPill';
import { PackageCategoryChip } from './PackageCategoryChip';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  pkg: Package;
  hotelSlug: string;
  onEdit: () => void;
  onOpenMenu: () => void;
  views7d?: number;
}

export function PackageCard({ pkg, hotelSlug, onEdit, onOpenMenu, views7d }: Props) {
  const t = useOwnerT('owner-packages');
  const monthsLabel = monthsToLabel(pkg.season_months, t);

  return (
    <article
      className="rounded-2xl border border-slate-800 bg-[#151A25] p-4 hover:border-slate-700 transition-colors"
      data-testid={`package-card-${pkg.id}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onEdit}
            className="text-left"
          >
            <h3 className="text-sm font-semibold text-slate-100 break-words hover:text-emerald-200">
              {pkg.name}
            </h3>
            {pkg.short_pitch && (
              <p className="mt-0.5 text-xs text-slate-400 line-clamp-2">{pkg.short_pitch}</p>
            )}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <PackageStatusPill status={pkg.status} />
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label={t('card.moreActions', 'More actions')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-700 bg-slate-800/60 text-slate-300 hover:bg-slate-800"
          >
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
        <PackageCategoryChip category={pkg.category} />
        <span className="inline-flex items-center gap-1">
          <Calendar className="h-3 w-3 text-slate-500" aria-hidden />
          {pkg.duration_nights}N · {monthsLabel}
        </span>
        <PackageApprovalPill status={pkg.owner_approval_status} />
        {views7d != null && views7d > 0 && (
          <span className="inline-flex items-center gap-1 text-slate-300">
            <Eye className="h-3 w-3 text-slate-500" aria-hidden />
            {t('card.views', '{{count}} views · 7d', { count: views7d })}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="text-[11px] text-slate-300 font-medium">
          {pkg.starting_price_text}
        </div>
        <div className="flex items-center gap-1.5">
          {pkg.status === 'ACTIVE' && pkg.owner_approval_status === 'APPROVED' && (
            <Link
              to={`/p/${hotelSlug}/package/${pkg.slug}`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200 hover:bg-emerald-500/20"
              data-testid={`package-public-link-${pkg.id}`}
            >
              {t('card.viewPublic', 'View public →')}
            </Link>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-[10px] text-slate-200 hover:bg-slate-800"
            data-testid={`package-edit-${pkg.id}`}
          >
            <Pencil className="h-3 w-3" aria-hidden />
            {t('card.edit', 'Edit')}
          </button>
        </div>
      </div>
    </article>
  );
}
