// web/src/components/packages/PackageStatusPill.tsx

import type { PackageStatus, PackageApprovalStatus } from '../../types/package';
import {
  PACKAGE_APPROVAL_LABEL,
  PACKAGE_STATUS_LABEL,
} from '../../config/packages';
import { useOwnerT } from '../../i18n/useOwnerT';

const STATUS_PILL: Record<PackageStatus, string> = {
  DRAFT:    'bg-slate-700/40 text-slate-200 border-slate-600',
  READY:    'bg-amber-500/15 text-amber-200 border-amber-500/40',
  ACTIVE:   'bg-emerald-500/15 text-emerald-200 border-emerald-500/40',
  PAUSED:   'bg-slate-600/30 text-slate-300 border-slate-500',
  ARCHIVED: 'bg-slate-800/60 text-slate-500 border-slate-700',
};

const APPROVAL_PILL: Record<PackageApprovalStatus, string> = {
  PENDING_REVIEW:    'bg-amber-500/10 text-amber-200 border-amber-500/30',
  APPROVED:          'bg-emerald-500/10 text-emerald-200 border-emerald-500/30',
  CHANGES_REQUESTED: 'bg-red-500/10 text-red-200 border-red-500/40',
};

export function PackageStatusPill({ status }: { status: PackageStatus }) {
  const t = useOwnerT('owner-packages');
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_PILL[status]}`}
      data-testid={`package-status-${status}`}
    >
      {t(`status.${status}`, PACKAGE_STATUS_LABEL[status])}
    </span>
  );
}

export function PackageApprovalPill({ status }: { status: PackageApprovalStatus }) {
  const t = useOwnerT('owner-packages');
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${APPROVAL_PILL[status]}`}
      data-testid={`package-approval-${status}`}
    >
      {t(`approval.${status}`, PACKAGE_APPROVAL_LABEL[status])}
    </span>
  );
}
