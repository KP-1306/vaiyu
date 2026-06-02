// web/src/components/quote/QuoteLeadPicker.tsx
//
// Read-only lead picker for AI Quote Drafts v0. Reads from the existing
// Lead CRM via listLeads() — hotel-member scoped, RLS-respected. NEVER
// writes; selection is a UI-only operation.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, User } from 'lucide-react';
import { listLeads } from '../../services/leadService';
import type { Lead, LeadStatus } from '../../types/lead';
import type { QuoteLeadSnapshot } from '../../types/quoteDraft';

const OPEN_STATUSES: LeadStatus[] = ['NEW', 'QUALIFIED', 'QUOTED', 'WON'];
const LIST_LIMIT = 50;

interface Props {
  hotelId: string;
  selectedLeadId: string | null;
  onSelect: (lead: QuoteLeadSnapshot | null) => void;
}

function leadToSnapshot(lead: Lead): QuoteLeadSnapshot {
  return {
    id: lead.id,
    name: lead.contact_name,
    partyAdults: lead.party_adults ?? 1,
    partyChildren: lead.party_children ?? 0,
    roomCount: lead.room_count ?? 1,
    checkIn: lead.requested_check_in,
    checkOut: lead.requested_check_out,
    source: lead.source,
    notePreview: lead.latest_note_preview,
  };
}

export function QuoteLeadPicker({ hotelId, selectedLeadId, onSelect }: Props) {
  const query = useQuery({
    queryKey: ['quote-drafts', 'leads', hotelId],
    queryFn: async () => {
      const result = await listLeads(hotelId, {
        status: OPEN_STATUSES,
        limit: LIST_LIMIT,
        orderBy: 'last_activity_at',
        orderDir: 'desc',
      });
      return result.leads;
    },
    enabled: !!hotelId,
    staleTime: 30_000,
  });

  const options = useMemo(() => query.data ?? [], [query.data]);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    if (!id) {
      onSelect(null);
      return;
    }
    const lead = options.find((l) => l.id === id);
    onSelect(lead ? leadToSnapshot(lead) : null);
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-100 inline-flex items-center gap-2">
          <User className="h-4 w-4 text-emerald-300" aria-hidden />
          Pick an enquiry
        </h3>
        {query.isFetching && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" aria-hidden />
        )}
      </div>

      <p className="text-xs text-slate-400">
        Choose from your open leads (status: New / Qualified / Quoted / Won). PII is read
        only — nothing is written or persisted by this workspace.
      </p>

      {query.isError ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-100">
          Could not load leads. {(query.error as Error).message}
        </div>
      ) : (
        <select
          data-testid="quote-lead-picker"
          value={selectedLeadId ?? ''}
          onChange={handleChange}
          disabled={query.isLoading}
          className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none disabled:opacity-50"
        >
          <option value="">
            {query.isLoading ? 'Loading enquiries…' : '— Select a lead —'}
          </option>
          {options.map((lead) => {
            const partyParts: string[] = [];
            if (lead.party_adults) partyParts.push(`${lead.party_adults}A`);
            if (lead.party_children) partyParts.push(`${lead.party_children}C`);
            const dates =
              lead.requested_check_in && lead.requested_check_out
                ? ` · ${lead.requested_check_in} → ${lead.requested_check_out}`
                : '';
            return (
              <option key={lead.id} value={lead.id}>
                {lead.contact_name} ({lead.status}){partyParts.length ? ` · ${partyParts.join('/')}` : ''}{dates}
              </option>
            );
          })}
        </select>
      )}

      {options.length === 0 && !query.isLoading && !query.isError && (
        <p className="text-[11px] text-slate-500">
          No open leads found for this hotel. Add a lead from the Leads workspace first.
        </p>
      )}
    </div>
  );
}
