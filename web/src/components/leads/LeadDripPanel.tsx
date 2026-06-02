// web/src/components/leads/LeadDripPanel.tsx
//
// Per-lead drip status panel, embedded in LeadDetailDrawer.
// Shows all subscriptions the lead has (one per rule), with:
//   • Rule name + status pill
//   • If ACTIVE: next step due time + step text preview + Pause button
//   • If PAUSED: paused reason + Resume button
//   • If COMPLETED/CANCELLED/NO_CHANNEL: terminal label
//   • Cancel button when status in (ACTIVE, PAUSED, NO_CHANNEL)
//
// Operator-callable. Auto-pause/cancel happens via lead-event triggers; this
// panel is for the manual lever.

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pause, Play, Trash2 } from 'lucide-react';

import {
  cancelLeadDrip,
  listDripRules,
  listDripSteps,
  listSubscriptionsForLead,
  pauseLeadDrip,
  resumeLeadDrip,
} from '../../services/dripService';
import { DRIP_ENGINE_V1_ENABLED, DRIP_PAUSE_REASON_LABEL, DRIP_RULE_KIND_LABEL } from '../../config/dripEngine';
import type {
  DripRule,
  DripStep,
  LeadDripSubscription,
} from '../../types/drip';

interface Props {
  leadId: string;
  hotelId: string;
}

export function LeadDripPanel({ leadId, hotelId }: Props) {
  const qc = useQueryClient();

  const subsQ = useQuery({
    queryKey: ['lead-drip-subs', leadId],
    queryFn: () => listSubscriptionsForLead(leadId),
    enabled: DRIP_ENGINE_V1_ENABLED && !!leadId,
    staleTime: 10_000,
  });
  const rulesQ = useQuery({
    queryKey: ['drip-rules', hotelId],
    queryFn: () => listDripRules(hotelId),
    enabled: DRIP_ENGINE_V1_ENABLED && !!hotelId,
    staleTime: 60_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['lead-drip-subs', leadId] });
  };

  const pauseMut  = useMutation({ mutationFn: (id: string) => pauseLeadDrip(id), onSuccess: invalidate });
  const resumeMut = useMutation({ mutationFn: (id: string) => resumeLeadDrip(id), onSuccess: invalidate });
  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => cancelLeadDrip(id, reason),
    onSuccess: invalidate,
  });

  const ruleById = useMemo(() => {
    const m = new Map<string, DripRule>();
    for (const r of rulesQ.data ?? []) m.set(r.id, r);
    return m;
  }, [rulesQ.data]);

  if (!DRIP_ENGINE_V1_ENABLED) return null;

  return (
    <section className="rounded-lg border border-slate-800 bg-[#0F1320] p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        Follow-up email sequences
      </h3>

      {subsQ.isLoading && (
        <div className="text-[12px] text-slate-500"><Loader2 className="inline h-3 w-3 animate-spin" /></div>
      )}

      {!subsQ.isLoading && (subsQ.data?.length ?? 0) === 0 && (
        <div className="text-[12px] text-slate-500">No drip sequences active for this lead.</div>
      )}

      <ul className="space-y-2">
        {subsQ.data?.map((sub) => (
          <SubscriptionRow
            key={sub.id}
            sub={sub}
            rule={ruleById.get(sub.rule_id) ?? null}
            onPause={() => pauseMut.mutate(sub.id)}
            onResume={() => resumeMut.mutate(sub.id)}
            onCancel={() => {
              const reason = prompt('Why cancel this sequence? (logged to audit)');
              if (!reason || !reason.trim()) return;
              cancelMut.mutate({ id: sub.id, reason: reason.trim() });
            }}
            busy={pauseMut.isPending || resumeMut.isPending || cancelMut.isPending}
          />
        ))}
      </ul>
    </section>
  );
}

interface RowProps {
  sub: LeadDripSubscription;
  rule: DripRule | null;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  busy: boolean;
}

function SubscriptionRow({ sub, rule, onPause, onResume, onCancel, busy }: RowProps) {
  const friendly = rule ? (DRIP_RULE_KIND_LABEL[rule.code] ?? rule.name) : 'Drip sequence';
  const isOpen = sub.status === 'ACTIVE' || sub.status === 'PAUSED' || sub.status === 'NO_CHANNEL';

  const nextStepQ = useQuery({
    queryKey: ['drip-step-preview', sub.rule_id, sub.next_step_idx],
    queryFn: async () => {
      if (sub.next_step_idx == null || !sub.rule_id) return null;
      const steps = await listDripSteps(sub.rule_id);
      return steps.find((s) => s.step_idx === sub.next_step_idx) ?? null;
    },
    enabled: sub.status === 'ACTIVE' && sub.next_step_idx != null,
    staleTime: 60_000,
  });

  return (
    <li className="rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm text-slate-100">{friendly}</div>
          <StatusLine sub={sub} nextStep={nextStepQ.data ?? null} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {sub.status === 'ACTIVE' && (
            <button
              type="button"
              onClick={onPause}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10.5px] text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
            >
              <Pause className="h-3 w-3" aria-hidden /> Pause
            </button>
          )}
          {sub.status === 'PAUSED' && (
            <button
              type="button"
              onClick={onResume}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10.5px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
            >
              <Play className="h-3 w-3" aria-hidden /> Resume
            </button>
          )}
          {isOpen && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              title="Cancel this sequence (terminal)"
              className="inline-flex items-center rounded-md border border-slate-700 px-2 py-1 text-[10.5px] text-slate-400 hover:bg-slate-800 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function StatusLine({ sub, nextStep }: { sub: LeadDripSubscription; nextStep: DripStep | null }) {
  if (sub.status === 'COMPLETED') {
    return <p className="text-[11px] text-slate-500">Sequence completed.</p>;
  }
  if (sub.status === 'CANCELLED') {
    return <p className="text-[11px] text-slate-500">Cancelled.</p>;
  }
  if (sub.status === 'NO_CHANNEL') {
    return <p className="text-[11px] text-amber-300">No email on file — add one and resume.</p>;
  }
  if (sub.status === 'PAUSED') {
    const reason = sub.paused_reason ? (DRIP_PAUSE_REASON_LABEL[sub.paused_reason] ?? sub.paused_reason) : 'Paused';
    return <p className="text-[11px] text-amber-300">Paused — {reason}</p>;
  }
  // ACTIVE
  if (sub.next_step_due_at) {
    const due = new Date(sub.next_step_due_at);
    const dueText = isNaN(due.getTime()) ? sub.next_step_due_at : due.toLocaleString('en-IN');
    return (
      <p className="text-[11px] text-slate-400">
        Next: <span className="text-emerald-300">step {(sub.next_step_idx ?? 0) + 1}</span> · {dueText}
        {nextStep && <span className="text-slate-500"> · {nextStep.template_code}</span>}
      </p>
    );
  }
  return <p className="text-[11px] text-slate-400">Active.</p>;
}
