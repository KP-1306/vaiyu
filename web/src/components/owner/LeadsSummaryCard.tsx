// web/src/components/owner/LeadsSummaryCard.tsx
//
// Dashboard widget that surfaces "open leads" count per status. Subscribes
// to useLeadsRealtime so it auto-updates as leads change. Click → /leads.

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Loader2, Users } from 'lucide-react';
import { listLeads } from '../../services/leadService';
import { leadQueryKeys } from '../../services/leadQueryKeys';
import { useLeadsRealtime } from '../../hooks/useLeadsRealtime';
import type { LeadStatus } from '../../types/lead';
import { LEAD_STATUS_CONFIG } from '../leads/LeadStatusPill.config';
import { useOwnerT } from '../../i18n/useOwnerT';

const OPEN_STATUSES: LeadStatus[] = ['NEW', 'QUALIFIED', 'QUOTED', 'WON'];

interface Props {
  hotelId: string | null;
  hotelSlug: string;
}

export function LeadsSummaryCard({ hotelId, hotelSlug }: Props) {
  const t = useOwnerT('owner-cards');
  // Keep realtime subscription alive whenever this card is rendered so the
  // count refreshes when leads change in any other tab/user session.
  useLeadsRealtime(hotelId ?? undefined);

  const query = useQuery({
    queryKey: hotelId ? leadQueryKeys.openSummary(hotelId) : ['leads-open-summary', null],
    queryFn: async () => {
      if (!hotelId) return null;
      // Fetch all open leads (limit 200 to support count + small breakdown without
      // a second query). 200 is enough for a status-breakdown summary; the
      // total still represents what's in cache.
      const result = await listLeads(hotelId, {
        status: OPEN_STATUSES,
        limit: 200,
        includeCount: true,
        orderBy: 'last_activity_at',
        orderDir: 'desc',
      });
      const byStatus: Record<LeadStatus, number> = {
        NEW: 0,
        QUALIFIED: 0,
        QUOTED: 0,
        WON: 0,
        CONVERTED: 0,
        LOST: 0,
      };
      for (const lead of result.leads) byStatus[lead.status] += 1;
      return { total: result.total ?? result.leads.length, byStatus };
    },
    enabled: !!hotelId,
    staleTime: 30_000,
  });

  const breakdownText = useMemo(() => {
    if (!query.data) return '';
    return OPEN_STATUSES
      .map((s) => t('leads.breakdownItem', '{{count}} {{label}}', { count: query.data!.byStatus[s], label: LEAD_STATUS_CONFIG[s].label.toLowerCase() }))
      .join(' · ');
  }, [query.data, t]);

  const total = query.data?.total ?? 0;

  return (
    <Link
      to={`/owner/${hotelSlug}/leads`}
      data-testid="leads-summary-card"
      className="block rounded-2xl border border-white/10 bg-white/[0.02] p-5 hover:bg-white/[0.04] hover:border-white/20 transition-colors group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-emerald-500/10 p-1.5 ring-1 ring-emerald-500/20">
            <Users className="h-4 w-4 text-emerald-300" />
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider text-white/60">
            {t('leads.title', 'Open leads')}
          </span>
        </div>
        <ChevronRight className="h-4 w-4 text-white/30 group-hover:text-white/60 transition-colors" />
      </div>

      {query.isPending ? (
        <div className="flex items-center gap-2 text-white/40 text-sm">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('common.loading', 'Loading…')}
        </div>
      ) : query.isError ? (
        <div className="text-sm text-red-300">{t('leads.couldNotLoad', 'Could not load')}</div>
      ) : (
        <>
          <div className="text-3xl font-semibold text-white tabular-nums">{total}</div>
          {breakdownText && (
            <div className="mt-2 text-[11px] text-white/50">{breakdownText}</div>
          )}
        </>
      )}
    </Link>
  );
}
