// web/src/components/owner/PartnersSummaryCard.tsx
//
// Compact dashboard tile for the Partner Network. Shows total / verified /
// preferred / stale counters with a deep-link to the directory. Contact
// fields are NOT shown here (PII stays in the detail drawer; this is a
// glance-only surface).

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Handshake, ChevronRight, AlertTriangle } from 'lucide-react';

import { listPartners } from '../../services/partnerService';
import { PARTNER_NETWORK_V1_ENABLED } from '../../config/partnerNetwork';

interface Props {
  hotelId: string;
  hotelSlug: string;
}

export function PartnersSummaryCard({ hotelId, hotelSlug }: Props) {
  const q = useQuery({
    queryKey: ['partners-summary', hotelId],
    queryFn: () => listPartners(hotelId, { limit: 200 }),
    enabled: !!hotelId && PARTNER_NETWORK_V1_ENABLED,
    staleTime: 30_000,
  });

  if (!PARTNER_NETWORK_V1_ENABLED) return null;

  const rows = q.data ?? [];
  const total = rows.length;
  const verified = rows.filter((r) => r.verification_status === 'VERIFIED').length;
  const preferred = rows.filter((r) => r.status === 'PREFERRED').length;
  const stale = rows.filter((r) => r.is_verification_stale).length;

  return (
    <div className="rounded-xl border border-slate-800 bg-[#0F1320] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Handshake className="h-4 w-4 text-emerald-300" aria-hidden />
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-300">
            Local Partner Directory
          </h3>
        </div>
        <Link
          to={`/owner/${hotelSlug}/partners`}
          className="inline-flex items-center gap-0.5 text-[11px] text-emerald-300 hover:underline"
          data-testid="partners-card-open"
        >
          Open <ChevronRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      {q.isLoading && (
        <div className="text-[12px] text-slate-500">Loading…</div>
      )}

      {!q.isLoading && total === 0 && (
        <div className="space-y-2">
          <p className="text-[12px] text-slate-400">
            No partners added yet. Track trusted vendors and commissionable agents in one place.
          </p>
          <Link
            to={`/owner/${hotelSlug}/partners`}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/20"
          >
            Add your first partner
          </Link>
        </div>
      )}

      {!q.isLoading && total > 0 && (
        <div className="grid grid-cols-4 gap-2">
          <Stat label="Total"     value={total} />
          <Stat label="Verified"  value={verified} tone="emerald" />
          <Stat label="Preferred" value={preferred} tone="amber" />
          <Stat label="Stale"     value={stale} tone={stale > 0 ? 'red' : 'neutral'} icon={stale > 0 ? AlertTriangle : undefined} />
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'neutral',
  icon: Icon,
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'emerald' | 'amber' | 'red';
  icon?: typeof AlertTriangle;
}) {
  const colour =
    tone === 'emerald' ? 'text-emerald-300' :
    tone === 'amber'   ? 'text-amber-300'   :
    tone === 'red'     ? 'text-red-300'     : 'text-slate-100';
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">
        {Icon && <Icon className="h-2.5 w-2.5" aria-hidden />}
        {label}
      </div>
      <div className={`mt-0.5 text-base font-semibold ${colour}`}>{value}</div>
    </div>
  );
}
