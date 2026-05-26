// web/src/components/leads/KanbanBoard.tsx
//
// The kanban view: 6 status columns, drag-drop transitions, optimistic moves,
// LOST reason modal, drag telemetry.
//
// Architecture:
//   - 6 parallel useQuery calls (one per status), each cap-limited to COLUMN_CAP
//   - DndContext at root with PointerSensor/TouchSensor/KeyboardSensor
//   - Single useMutation handles all transitions (optimistic add/remove)
//   - LOST drops open LostReasonModal first; modal submit fires mutation
//   - DragOverlay renders the dragged card in a portal — immune to cache re-renders

import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listLeads,
  LeadServiceError,
  transitionLeadStatus,
  type ListLeadsResult,
} from '../../services/leadService';
import type { Lead, LeadStatus } from '../../types/lead';
import { LEAD_STATUS_CONFIG } from './LeadStatusPill.config';
import { humanizeError } from './LeadQuickAddModal.errorMapping';
import {
  COLUMN_CAP,
  KANBAN_COLUMN_ORDER,
  canDropInKanban,
  detectViewport,
  explainBlockedDrop,
  requiresConfirmationModal,
  trackDragEvent,
} from './kanbanHelpers';
import {
  filtersToSearchParams,
  toServiceFilters,
  nullsLastForSort,
  type LeadFiltersUrlState,
} from './leadsFilters';
import { KanbanColumn } from './KanbanColumn';
import { KanbanLeadCardOverlay } from './KanbanLeadCard';
import { LostReasonModal } from './LostReasonModal';

interface Props {
  hotelId: string;
  slug: string;
  filters: LeadFiltersUrlState;
  currentUserId: string | null;
  showToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
  /** Card click → open detail drawer. Day 9 wires URL ?lead=<id>. */
  onCardClick?: (lead: { id: string }) => void;
}

interface DragSourceRef {
  lead: Lead;
  fromStatus: LeadStatus;
}

type LostModalState = {
  leadId: string;
  leadName: string;
  fromStatus: LeadStatus;
} | null;

export function KanbanBoard({ hotelId, slug, filters, currentUserId, showToast, onCardClick }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ──────────────────────────────────────────────────────────────────────
  // KANBAN QUERY KEY INVARIANTS — do not break:
  //
  // 1. baseFiltersExceptStatus MUST be referentially stable. The useMemo
  //    below guarantees this — DO NOT inline filter computation per-render
  //    or you'll explode 6 caches per render cycle.
  //
  // 2. queryKey shape: ['leads-kanban', hotelId, status, baseFiltersExceptStatus].
  //    Each status column is its own cache entry; realtime invalidation by
  //    prefix ['leads-kanban', hotelId] re-fetches all 6 columns.
  //
  // 3. status filter from URL narrows visible columns — when set, only
  //    those columns mount their queries. Others are disabled and not fetched.
  // ──────────────────────────────────────────────────────────────────────

  // Translate URL filters → service filter base (without status — we add per-column)
  const baseFiltersExceptStatus = useMemo(() => {
    const sf = toServiceFilters(filters, currentUserId);
    return {
      search: sf.search,
      source: sf.source,
      assignedTo: sf.assignedTo,
      orderBy: sf.orderBy,
      orderDir: sf.orderDir,
      nullsLast: nullsLastForSort(filters.sort),
      includeDeleted: false,
    };
  }, [filters, currentUserId]);

  // Which columns to render. Default = all 6. If status filter is set,
  // narrow to those.
  const visibleStatuses = useMemo<LeadStatus[]>(() => {
    if (filters.status && filters.status.length > 0) return filters.status;
    return [...KANBAN_COLUMN_ORDER];
  }, [filters.status]);

  // 6 parallel queries — one per status. Hooks order MUST be stable, so all 6
  // are declared unconditionally; we use `enabled` to skip those not visible.
  const useColumnQuery = (status: LeadStatus) => {
    return useQuery({
      queryKey: ['leads-kanban', hotelId, status, baseFiltersExceptStatus],
      queryFn: () =>
        listLeads(hotelId, {
          ...baseFiltersExceptStatus,
          status: [status],
          limit: COLUMN_CAP,
          includeCount: true,
        }),
      enabled: !!hotelId && visibleStatuses.includes(status),
    });
  };
  /* eslint-disable react-hooks/rules-of-hooks */
  // Hooks must be in stable order — this calls the 6 hooks in declaration order
  const qNew = useColumnQuery('NEW');
  const qQualified = useColumnQuery('QUALIFIED');
  const qQuoted = useColumnQuery('QUOTED');
  const qWon = useColumnQuery('WON');
  const qConverted = useColumnQuery('CONVERTED');
  const qLost = useColumnQuery('LOST');
  /* eslint-enable react-hooks/rules-of-hooks */

  const columnQueries = useMemo(
    () => ({
      NEW: qNew,
      QUALIFIED: qQualified,
      QUOTED: qQuoted,
      WON: qWon,
      CONVERTED: qConverted,
      LOST: qLost,
    }),
    [qNew, qQualified, qQuoted, qWon, qConverted, qLost],
  );

  // ─── Mutation: transition_lead_status ────────────────────────────────
  const transitionMutation = useMutation({
    mutationFn: (vars: {
      leadId: string;
      fromStatus: LeadStatus;
      toStatus: LeadStatus;
      reason?: string;
    }) => transitionLeadStatus(vars.leadId, vars.toStatus, { reason: vars.reason }),

    onMutate: async (vars) => {
      const fromKey = ['leads-kanban', hotelId, vars.fromStatus, baseFiltersExceptStatus];
      const toKey = ['leads-kanban', hotelId, vars.toStatus, baseFiltersExceptStatus];
      await queryClient.cancelQueries({ queryKey: fromKey });
      await queryClient.cancelQueries({ queryKey: toKey });

      const prevFrom = queryClient.getQueryData<ListLeadsResult>(fromKey);
      const prevTo = queryClient.getQueryData<ListLeadsResult>(toKey);

      const movingLead = prevFrom?.leads.find((l) => l.id === vars.leadId);

      // Remove from source
      if (prevFrom) {
        queryClient.setQueryData<ListLeadsResult>(fromKey, {
          leads: prevFrom.leads.filter((l) => l.id !== vars.leadId),
          total: prevFrom.total !== null ? Math.max(0, prevFrom.total - 1) : null,
        });
      }

      // Prepend to target.
      //
      // NOTE: canonical order within a column is `last_activity_at DESC`. The
      // optimistic prepend (the moved lead is "freshly active") is correct
      // 99% of the time. In rare cases — e.g., the column had a very recent
      // activity from another user that arrived between drag start and drop
      // — the optimistic position may briefly differ from canonical by 1-2
      // positions until the next refetch settles (typically <250ms).
      // Accepted v1 trade-off per Day 8 plan.
      if (movingLead && prevTo) {
        const updated: Lead = {
          ...movingLead,
          status: vars.toStatus,
          last_activity_at: new Date().toISOString(),
        };
        queryClient.setQueryData<ListLeadsResult>(toKey, {
          leads: [updated, ...prevTo.leads.slice(0, COLUMN_CAP - 1)],
          total: prevTo.total !== null ? prevTo.total + 1 : null,
        });
      }

      return { prevFrom, prevTo, fromKey, toKey };
    },

    onError: (err, _vars, ctx) => {
      if (ctx) {
        queryClient.setQueryData(ctx.fromKey, ctx.prevFrom);
        queryClient.setQueryData(ctx.toKey, ctx.prevTo);
      }
      const lse = err as LeadServiceError;
      showToast(humanizeError(lse), 'error');
    },

    onSuccess: (_data, vars) => {
      showToast(`Moved to ${LEAD_STATUS_CONFIG[vars.toStatus].label}`, 'success');
    },

    onSettled: (_data, _err, vars) => {
      queryClient.invalidateQueries({ queryKey: ['leads-kanban', hotelId, vars.fromStatus] });
      queryClient.invalidateQueries({ queryKey: ['leads-kanban', hotelId, vars.toStatus] });
    },
  });

  // ─── Drag state ──────────────────────────────────────────────────────
  const [activeDrag, setActiveDrag] = useState<DragSourceRef | null>(null);
  const dragSourceRef = useRef<DragSourceRef | null>(null);
  const dragStartTimeRef = useRef<number>(0);
  const [lostModalState, setLostModalState] = useState<LostModalState>(null);

  // Sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragStart = useCallback((e: DragStartEvent) => {
    const data = e.active.data.current as
      | { lead: Lead; fromStatus: LeadStatus }
      | undefined;
    if (!data) return;
    dragSourceRef.current = { lead: data.lead, fromStatus: data.fromStatus };
    setActiveDrag(dragSourceRef.current);
    dragStartTimeRef.current = performance.now();
    trackDragEvent({
      type: 'drag.started',
      from: data.fromStatus,
      leadId: data.lead.id,
      viewport: detectViewport(),
    });
  }, []);

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      // Edge case: if filter changed mid-drag, the source column may have
      // unmounted. dnd-kit gracefully fires onDragEnd with `e.active` populated;
      // we still proceed if the drop target is valid. UX may feel abrupt but
      // the operation completes correctly.
      const source = dragSourceRef.current;
      setActiveDrag(null);
      if (!source) return;

      if (!e.over) {
        trackDragEvent({
          type: 'drag.cancelled',
          from: source.fromStatus,
          leadId: source.lead.id,
          reason: 'no_target',
        });
        dragSourceRef.current = null;
        return;
      }

      const targetStatus = e.over.id as LeadStatus;

      if (!canDropInKanban(source.fromStatus, targetStatus)) {
        trackDragEvent({
          type: 'drag.invalid_drop',
          from: source.fromStatus,
          attempted_to: targetStatus,
          leadId: source.lead.id,
        });
        const msg = explainBlockedDrop(source.fromStatus, targetStatus);
        if (msg) showToast(msg, 'warning');
        dragSourceRef.current = null;
        return;
      }

      // LOST requires reason modal — defer mutation
      if (requiresConfirmationModal(targetStatus) === 'LOST') {
        setLostModalState({
          leadId: source.lead.id,
          leadName: source.lead.contact_name,
          fromStatus: source.fromStatus,
        });
        // Keep dragSourceRef populated until modal closes (submit or cancel)
        return;
      }

      // Direct transition
      const duration_ms = Math.round(performance.now() - dragStartTimeRef.current);
      trackDragEvent({
        type: 'drag.completed',
        from: source.fromStatus,
        to: targetStatus,
        leadId: source.lead.id,
        duration_ms,
        required_modal: false,
      });
      transitionMutation.mutate({
        leadId: source.lead.id,
        fromStatus: source.fromStatus,
        toStatus: targetStatus,
      });
      dragSourceRef.current = null;
    },
    [showToast, transitionMutation],
  );

  const handleLostCancel = useCallback(() => {
    const source = dragSourceRef.current;
    if (source) {
      trackDragEvent({
        type: 'drag.cancelled',
        from: source.fromStatus,
        leadId: source.lead.id,
        reason: 'modal_cancel',
      });
    }
    dragSourceRef.current = null;
    setLostModalState(null);
  }, []);

  const handleLostSubmit = useCallback(
    async (reason: string) => {
      const source = dragSourceRef.current;
      if (!source) return;
      const duration_ms = Math.round(performance.now() - dragStartTimeRef.current);
      trackDragEvent({
        type: 'drag.completed',
        from: source.fromStatus,
        to: 'LOST',
        leadId: source.lead.id,
        duration_ms,
        required_modal: true,
      });
      try {
        await transitionMutation.mutateAsync({
          leadId: source.lead.id,
          fromStatus: source.fromStatus,
          toStatus: 'LOST',
          reason,
        });
        setLostModalState(null);
      } finally {
        dragSourceRef.current = null;
      }
    },
    [transitionMutation],
  );

  const goToListWithFilter = useCallback(
    (status: LeadStatus) => {
      const next = filtersToSearchParams({ ...filters, status: [status], page: 1 });
      next.set('view', 'list');
      navigate(`/owner/${slug}/leads?${next.toString()}`);
    },
    [filters, navigate, slug],
  );

  return (
    <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div
          data-testid="kanban-board"
          className="flex gap-3 overflow-x-auto pb-4 snap-x snap-mandatory scroll-px-4"
        >
          {visibleStatuses.map((status) => {
            const q = columnQueries[status];
            return (
              <KanbanColumn
                key={status}
                status={status}
                leads={q.data?.leads ?? []}
                totalInColumn={q.data?.total ?? null}
                isLoading={q.isPending}
                activeDragFrom={activeDrag?.fromStatus ?? null}
                onViewInList={() => goToListWithFilter(status)}
                onCardClick={onCardClick}
              />
            );
          })}
        </div>

        <DragOverlay
          // Animation: snap back smoothly on cancel/invalid
          dropAnimation={{
            duration: 180,
            easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
          }}
        >
          {activeDrag ? <KanbanLeadCardOverlay lead={activeDrag.lead} /> : null}
        </DragOverlay>
      </DndContext>

      <LostReasonModal
        isOpen={lostModalState !== null}
        leadName={lostModalState?.leadName ?? ''}
        onConfirm={handleLostSubmit}
        onCancel={handleLostCancel}
      />
    </>
  );
}
