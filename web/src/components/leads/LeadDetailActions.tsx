// web/src/components/leads/LeadDetailActions.tsx
//
// Toolbar with: assign dropdown, convert-to-booking button (stub for Day 9 / wired in Day 10),
// and soft-delete button (manager-only).

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  Check,
  Trash2,
  Loader2,
  ArrowUpRight,
} from 'lucide-react';
import type { Lead } from '../../types/lead';
import { assignLead, softDeleteLead, LeadServiceError } from '../../services/leadService';
import { humanizeError } from './LeadQuickAddModal.errorMapping';

interface Props {
  lead: Lead;
  currentUserId: string | null;
  canEdit: boolean;
  isManager: boolean;
  showToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
  onAfterAction: () => void;
  /** Called after a soft-delete so the drawer can close. */
  onAfterDelete: () => void;
  /** Open the convert-to-booking modal (Day 10). */
  onOpenConvert: () => void;
}

export function LeadDetailActions({
  lead,
  currentUserId,
  canEdit,
  isManager,
  showToast,
  onAfterAction,
  onAfterDelete,
  onOpenConvert,
}: Props) {
  const queryClient = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!assignOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setAssignOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAssignOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [assignOpen]);

  const assignMutation = useMutation({
    mutationFn: (target: 'me' | 'unassign') =>
      assignLead(lead.id, target === 'me' ? (currentUserId as string) : null),
    onSuccess: (_data, target) => {
      showToast(target === 'me' ? 'Assigned to you' : 'Unassigned', 'success');
      setAssignOpen(false);
      queryClient.invalidateQueries({ queryKey: ['lead', lead.id] });
      queryClient.invalidateQueries({ queryKey: ['lead-events', lead.id] });
      onAfterAction();
    },
    onError: (err) => {
      showToast(humanizeError(err as LeadServiceError), 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => softDeleteLead(lead.id, 'Deleted from lead detail'),
    onSuccess: () => {
      showToast('Lead deleted', 'success');
      queryClient.invalidateQueries({ queryKey: ['leads', lead.hotel_id] });
      queryClient.invalidateQueries({ queryKey: ['leads-kanban', lead.hotel_id] });
      onAfterDelete();
    },
    onError: (err) => {
      showToast(humanizeError(err as LeadServiceError), 'error');
    },
  });

  function handleDelete() {
    if (!window.confirm(`Delete lead "${lead.contact_name}"?\nThis hides it from the list and timeline (audit history preserved).`)) {
      return;
    }
    deleteMutation.mutate();
  }

  function handleConvert() {
    onOpenConvert();
  }

  const assignedLabel =
    lead.assigned_to === null
      ? 'Unassigned'
      : lead.assigned_to === currentUserId
      ? 'Assigned to you'
      : 'Assigned';

  return (
    <section
      data-testid="lead-detail-actions"
      className="px-5 py-3 border-b border-white/10 flex items-center gap-2 flex-wrap"
    >
      {/* Assign dropdown */}
      <div ref={rootRef} className="relative">
        <button
          type="button"
          onClick={() => canEdit && setAssignOpen((v) => !v)}
          disabled={!canEdit || assignMutation.isPending}
          aria-expanded={assignOpen}
          aria-haspopup="menu"
          className={`
            inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium
            ring-1 transition-colors
            ${lead.assigned_to === null
              ? 'bg-white/[0.03] text-white/70 ring-white/10'
              : 'bg-indigo-500/15 text-indigo-200 ring-indigo-500/30'}
            ${canEdit ? 'hover:bg-white/[0.06]' : 'opacity-60 cursor-not-allowed'}
          `}
        >
          {assignMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          {assignedLabel}
          {canEdit && <ChevronDown className={`h-3 w-3 transition-transform ${assignOpen ? 'rotate-180' : ''}`} />}
        </button>

        {assignOpen && (
          <div
            role="menu"
            className="absolute z-40 mt-2 w-44 rounded-lg border border-white/10 bg-[#15171c] shadow-xl p-1.5 left-0"
          >
            <button
              type="button"
              onClick={() => assignMutation.mutate('me')}
              disabled={!currentUserId || lead.assigned_to === currentUserId}
              role="menuitem"
              className="flex items-center justify-between w-full px-2 py-1.5 rounded-md text-sm text-white/80 hover:bg-white/[0.05] disabled:opacity-40 disabled:cursor-not-allowed text-left"
            >
              Assign to me
              {lead.assigned_to === currentUserId && <Check className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={() => assignMutation.mutate('unassign')}
              disabled={lead.assigned_to === null}
              role="menuitem"
              className="flex items-center justify-between w-full px-2 py-1.5 rounded-md text-sm text-white/80 hover:bg-white/[0.05] disabled:opacity-40 disabled:cursor-not-allowed text-left"
            >
              Unassign
              {lead.assigned_to === null && <Check className="h-3 w-3" />}
            </button>
          </div>
        )}
      </div>

      {/* Convert button — shown for any non-CONVERTED, non-LOST status.
          Day 4 RPC auto-promotes intermediate stages atomically. */}
      {lead.status !== 'CONVERTED' && lead.status !== 'LOST' && (
        <button
          type="button"
          onClick={handleConvert}
          disabled={!canEdit}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-60"
        >
          <ArrowUpRight className="h-3 w-3" />
          Convert to booking
        </button>
      )}

      <div className="flex-1" />

      {isManager && (
        <button
          type="button"
          data-testid="lead-detail-soft-delete"
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-red-300/80 hover:text-red-200 hover:bg-red-500/10 disabled:opacity-50"
        >
          {deleteMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
          Delete
        </button>
      )}
    </section>
  );
}
