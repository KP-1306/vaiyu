// web/src/components/leads/LeadQuickAddModal.optimistic.ts
//
// Builds an optimistic Lead row for TanStack Query cache injection during a
// create_lead mutation. The flag `__optimistic: true` and `__client_request_id`
// are UI-only metadata — never sent to the server.
//
// Cleanup is implicit: onSettled invalidates the leads query, the refetch
// returns canonical DB rows (without the optimistic), and the optimistic
// disappears naturally.
//
// CRITICAL INVARIANT: callers MUST NOT call setQueryData with the real result
// in onSuccess. Doing so re-introduces the optimistic-row-survival race the
// reviewer flagged. Only onMutate (add optimistic) and onError (rollback) call
// setQueryData. onSuccess is for UI side effects only.

import type { CreateLeadInput, Lead } from '../../types/lead';

export type OptimisticLead = Lead & {
  __optimistic: true;
  __client_request_id: string;
};

export function isOptimisticLead(lead: Lead | OptimisticLead): lead is OptimisticLead {
  return (
    typeof lead === 'object' &&
    lead !== null &&
    '__optimistic' in lead &&
    (lead as OptimisticLead).__optimistic === true
  );
}

export interface BuildOptimisticLeadDeps {
  now?: () => string;
  uuid?: () => string;
}

export function buildOptimisticLead(
  input: CreateLeadInput,
  hotelId: string,
  actorId: string | null,
  deps: BuildOptimisticLeadDeps = {},
): OptimisticLead {
  const nowIso = (deps.now ?? (() => new Date().toISOString()))();
  const clientRequestId = (deps.uuid ?? (() => crypto.randomUUID()))();

  return {
    id: `optimistic-${clientRequestId}`,
    hotel_id: hotelId,
    source: input.source,
    source_detail: input.sourceDetail ?? null,
    partner_id: null,
    contact_name: input.contactName,
    contact_phone: input.contactPhone ?? null,
    contact_phone_normalized: null,
    contact_email: input.contactEmail ?? null,
    requested_check_in: input.checkIn ?? null,
    requested_check_out: input.checkOut ?? null,
    party_adults: input.partyAdults ?? 1,
    party_children: input.partyChildren ?? 0,
    room_count: input.roomCount ?? 1,
    value_estimate: input.valueEstimate ?? null,
    status: 'NEW',
    status_reason: null,
    assigned_to: null,
    claimed_by: null,
    claimed_at: null,
    converted_booking_id: null,
    won_at: null,
    converted_at: null,
    latest_note_preview: input.notes?.slice(0, 200) ?? null,
    tags: input.tags ?? [],
    created_at: nowIso,
    created_by: actorId,
    updated_at: nowIso,
    last_activity_at: nowIso,
    deleted_at: null,
    __optimistic: true,
    __client_request_id: clientRequestId,
  };
}
