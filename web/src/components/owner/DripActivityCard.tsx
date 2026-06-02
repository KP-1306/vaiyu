// web/src/components/owner/DripActivityCard.tsx
//
// Dashboard tile summarising drip engine activity for the hotel.
// Shows counts of active / paused / due-soon subscriptions and (best-effort)
// the count of drip rows sent today by querying notification_queue.

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Mail } from 'lucide-react';

import { supabase } from '../../lib/supabase';
import { listSubscriptionsForHotel } from '../../services/dripService';
import { DRIP_ENGINE_V1_ENABLED } from '../../config/dripEngine';

interface Props {
  hotelId: string;
  hotelSlug: string;
}

export function DripActivityCard({ hotelId, hotelSlug }: Props) {
  const subsQ = useQuery({
    queryKey: ['drip-subs-summary', hotelId],
    queryFn: () => listSubscriptionsForHotel(hotelId, { limit: 500 }),
    enabled: !!hotelId && DRIP_ENGINE_V1_ENABLED,
    staleTime: 30_000,
  });

  const sentTodayQ = useQuery({
    queryKey: ['drip-sent-today', hotelId],
    queryFn: async () => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { count } = await supabase
        .from('notification_queue')
        .select('id', { count: 'exact', head: true })
        .eq('hotel_id', hotelId)
        .eq('status', 'sent')
        .not('drip_subscription_id', 'is', null)
        .gte('sent_at', startOfDay.toISOString());
      return count ?? 0;
    },
    enabled: !!hotelId && DRIP_ENGINE_V1_ENABLED,
    staleTime: 60_000,
  });

  if (!DRIP_ENGINE_V1_ENABLED) return null;

  const subs = subsQ.data ?? [];
  const active = subs.filter((s) => s.status === 'ACTIVE').length;
  const paused = subs.filter((s) => s.status === 'PAUSED').length;
  const noChannel = subs.filter((s) => s.status === 'NO_CHANNEL').length;
  const dueSoon = subs.filter((s) =>
    s.status === 'ACTIVE' &&
    s.next_step_due_at &&
    new Date(s.next_step_due_at).getTime() < Date.now() + 24 * 60 * 60 * 1000
  ).length;

  return (
    <div className="rounded-xl border border-slate-800 bg-[#0F1320] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-emerald-300" aria-hidden />
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-300">
            Follow-up emails
          </h3>
        </div>
        <Link
          to={`/owner/${hotelSlug}/drip`}
          className="inline-flex items-center gap-0.5 text-[11px] text-emerald-300 hover:underline"
          data-testid="drip-card-open"
        >
          Edit sequences <ChevronRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Stat label="Active"     value={active} tone="emerald" />
        <Stat label="Due 24h"    value={dueSoon} tone={dueSoon > 0 ? 'amber' : 'neutral'} />
        <Stat label="Sent today" value={sentTodayQ.data ?? 0} />
        <Stat label="Paused"     value={paused + noChannel} tone={paused + noChannel > 0 ? 'amber' : 'neutral'} />
      </div>

      {noChannel > 0 && (
        <p className="mt-2 text-[10.5px] text-amber-300">
          {noChannel} lead{noChannel === 1 ? '' : 's'} stuck — no email on file.
        </p>
      )}
    </div>
  );
}

function Stat({
  label, value, tone = 'neutral',
}: { label: string; value: number; tone?: 'neutral' | 'emerald' | 'amber' | 'red' }) {
  const colour =
    tone === 'emerald' ? 'text-emerald-300' :
    tone === 'amber'   ? 'text-amber-300'   :
    tone === 'red'     ? 'text-red-300'     : 'text-slate-100';
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1.5">
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-0.5 text-base font-semibold ${colour}`}>{value}</div>
    </div>
  );
}
