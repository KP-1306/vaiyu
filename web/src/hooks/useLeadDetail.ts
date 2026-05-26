// web/src/hooks/useLeadDetail.ts
//
// Bundles the 3 queries the LeadDetailDrawer needs (lead row, events, claim).
// Realtime invalidation already handled by useLeadEventsRealtime called inside
// useLeadClaimLifecycle (one subscription per drawer-mount).

import { useQuery } from '@tanstack/react-query';
import { getLead, getLeadEvents } from '../services/leadService';
import type { Lead, LeadEvent } from '../types/lead';

export interface LeadDetailData {
  lead: Lead | null | undefined;
  events: LeadEvent[];
  isLeadLoading: boolean;
  isEventsLoading: boolean;
  isLeadError: boolean;
  leadError: Error | null;
  refetchLead: () => void;
  refetchEvents: () => void;
}

export function useLeadDetail(leadId: string | null): LeadDetailData {
  const leadQ = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => getLead(leadId!),
    enabled: !!leadId,
  });

  const eventsQ = useQuery({
    queryKey: ['lead-events', leadId],
    queryFn: () => getLeadEvents(leadId!, { limit: 100 }),
    enabled: !!leadId,
  });

  return {
    lead: leadQ.data,
    events: eventsQ.data ?? [],
    isLeadLoading: leadQ.isPending,
    isEventsLoading: eventsQ.isPending,
    isLeadError: leadQ.isError,
    leadError: leadQ.error as Error | null,
    refetchLead: () => leadQ.refetch(),
    refetchEvents: () => eventsQ.refetch(),
  };
}
