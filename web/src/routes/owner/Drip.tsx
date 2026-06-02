// web/src/routes/owner/Drip.tsx
//
// Drip rule editor — Position 2 of the growth sheet.
// Layout:
//   • Header (hotel name + brief explainer)
//   • One section per rule (GENERAL_ENQUIRY / QUOTE_SENT / WALKIN_LOST + custom):
//       - rule.name, trigger, daily cap
//       - active toggle
//       - per-step editor cards
//   • Anti-feature notice: VAiyu sends emails; no SMS without Meta approval.

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Loader2, Power } from 'lucide-react';

import { supabase } from '../../lib/supabase';
import { DRIP_ENGINE_V1_ENABLED, DRIP_RULE_KIND_LABEL } from '../../config/dripEngine';
import {
  listDripRules,
  listDripSteps,
  setDripRuleActive,
} from '../../services/dripService';
import { DripStepEditor } from '../../components/drip/DripStepEditor';
import type { DripRule } from '../../types/drip';

interface Hotel { id: string; name: string; slug: string; }

export default function Drip() {
  const { slug: rawSlug } = useParams();
  const slug = (rawSlug ?? '').trim();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [hotelLoading, setHotelLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchHotel() {
      setHotelLoading(true);
      const { data } = await supabase
        .from('hotels')
        .select('id, name, slug')
        .eq('slug', slug)
        .maybeSingle();
      if (!cancelled) {
        setHotel((data as Hotel | null) ?? null);
        setHotelLoading(false);
      }
    }
    if (slug) fetchHotel();
    return () => { cancelled = true; };
  }, [slug]);

  const rulesQ = useQuery({
    queryKey: ['drip-rules', hotel?.id],
    queryFn: () => listDripRules(hotel!.id),
    enabled: !!hotel?.id && DRIP_ENGINE_V1_ENABLED,
    staleTime: 10_000,
  });

  if (!DRIP_ENGINE_V1_ENABLED) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 text-slate-300">
        Drip engine is disabled.
      </main>
    );
  }
  if (hotelLoading) {
    return <main className="mx-auto max-w-5xl px-4 py-10 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></main>;
  }
  if (!hotel) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 text-slate-300">
        Hotel not found for slug <code>{slug}</code>.
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#070914] text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <header className="mb-5">
          <p className="text-[11px] uppercase tracking-widest text-slate-500">Growth · {hotel.name}</p>
          <h1 className="mt-1 text-2xl font-semibold">Follow-up email sequences</h1>
          <p className="mt-1 text-sm text-slate-400">
            VAiyu sends these emails automatically on the schedule below — pause via Lead detail or disable a rule here.
            Drips auto-pause when a lead moves to Qualified / Won / Converted, and cancel on Lost.
          </p>
        </header>

        <div className="mb-4 rounded-md border border-slate-800 bg-[#0F1320] px-3 py-2 text-[11.5px] text-slate-400">
          Email channel only for v1. WhatsApp opens after Meta template approval.
          Daily send cap defaults to 200/hotel — adjust in hotel settings if needed.
        </div>

        {rulesQ.isLoading && (
          <div className="text-slate-400"><Loader2 className="inline h-4 w-4 animate-spin" /></div>
        )}
        {rulesQ.data?.length === 0 && (
          <div className="rounded-lg border border-slate-800 bg-[#0F1320] p-4 text-sm text-slate-400">
            No drip rules. (Stock rules are seeded on hotel creation — this shouldn't be empty.)
          </div>
        )}

        <div className="space-y-3">
          {rulesQ.data?.map((rule) => (
            <RuleCard key={rule.id} rule={rule} onChanged={() => rulesQ.refetch()} />
          ))}
        </div>
      </div>
    </main>
  );
}

function RuleCard({ rule, onChanged }: { rule: DripRule; onChanged: () => void }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(rule.code === 'GENERAL_ENQUIRY');
  const [toggling, setToggling] = useState(false);

  const stepsQ = useQuery({
    queryKey: ['drip-steps', rule.id],
    queryFn: () => listDripSteps(rule.id),
    enabled: expanded,
    staleTime: 10_000,
  });

  const friendly = DRIP_RULE_KIND_LABEL[rule.code] ?? rule.name;
  const triggerLabel =
    rule.trigger_event === 'LEAD_CREATED'      ? 'Fires when a new lead is created' :
    rule.trigger_event === 'LEAD_QUOTED'       ? 'Fires when a lead reaches QUOTED' :
                                                  'Fires when a walk-in lead is marked LOST';

  const toggleActive = async () => {
    setToggling(true);
    try {
      await setDripRuleActive(rule.id, !rule.active);
      qc.invalidateQueries({ queryKey: ['drip-rules', rule.hotel_id] });
      onChanged();
    } finally {
      setToggling(false);
    }
  };

  return (
    <section className="rounded-lg border border-slate-800 bg-[#0F1320]">
      <header className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex items-start gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="mt-0.5 h-4 w-4 text-slate-400" aria-hidden />
          ) : (
            <ChevronRight className="mt-0.5 h-4 w-4 text-slate-400" aria-hidden />
          )}
          <div>
            <div className="text-sm font-semibold text-slate-100">{friendly}</div>
            <div className="text-[11px] text-slate-500">
              <code className="text-slate-400">{rule.code}</code> · {triggerLabel}
            </div>
            {rule.description && (
              <div className="mt-0.5 text-[11.5px] text-slate-400">{rule.description}</div>
            )}
          </div>
        </button>
        <div className="flex items-center gap-2">
          <span
            className={
              rule.active
                ? 'rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-200'
                : 'rounded-full bg-slate-700/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400'
            }
          >
            {rule.active ? 'Active' : 'Disabled'}
          </span>
          <button
            type="button"
            onClick={toggleActive}
            disabled={toggling}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            {toggling ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Power className="h-3 w-3" aria-hidden />}
            {rule.active ? 'Disable' : 'Enable'}
          </button>
        </div>
      </header>

      {expanded && (
        <div className="border-t border-slate-800 px-4 py-3">
          {stepsQ.isLoading && (
            <div className="text-slate-400"><Loader2 className="inline h-4 w-4 animate-spin" /></div>
          )}
          <div className="space-y-3">
            {stepsQ.data?.map((step) => (
              <DripStepEditor
                key={step.id}
                step={step}
                onSaved={() => stepsQ.refetch()}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
