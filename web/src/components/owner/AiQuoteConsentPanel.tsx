// web/src/components/owner/AiQuoteConsentPanel.tsx
//
// Per-hotel AI Quote Drafts consent toggle. Used in OwnerSettings to let an
// owner/manager opt the property in or out of live AI generation.
//
// Writes via set_hotel_ai_quote_consent RPC (manager+ only, enforced server-side).
// On toggle success, refreshes the consent query everywhere else.

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2, Sparkles } from 'lucide-react';
import {
  getHotelAiConsent,
  setHotelAiConsent,
} from '../../services/quoteDraftService';

interface Props {
  hotelId: string;
}

export default function AiQuoteConsentPanel({ hotelId }: Props) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const consentQ = useQuery({
    queryKey: ['quote-drafts', 'consent', hotelId],
    queryFn: () => getHotelAiConsent(hotelId),
    enabled: !!hotelId,
    staleTime: 30_000,
  });

  const consented = consentQ.data?.consented ?? false;
  const cap = consentQ.data?.dailyTokenCap ?? 0;

  async function handleToggle() {
    setBusy(true);
    setErr(null);
    try {
      await setHotelAiConsent(hotelId, !consented);
      await qc.invalidateQueries({ queryKey: ['quote-drafts', 'consent', hotelId] });
    } catch (e) {
      setErr((e as Error).message ?? 'Could not update consent');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 sm:p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-medium text-white">
            <Sparkles className="h-4 w-4 text-emerald-300" aria-hidden />
            AI Quote Drafts
          </div>
          <p className="text-xs text-white/70 mt-0.5 max-w-xl">
            Allow your front-desk team to use Anthropic Claude to draft quote proposals from
            real lead data. Drafts are always edited and approved by your team before being
            sent. Token usage is logged and capped per day.
          </p>
          <p className="text-[11px] text-white/50 mt-1 italic">
            AI sirf draft banata hai. Bhejna aur final price humesha staff ke control mein hota hai.
          </p>
        </div>

        <button
          type="button"
          onClick={handleToggle}
          disabled={busy || consentQ.isLoading}
          aria-pressed={consented}
          data-testid="ai-quote-consent-toggle"
          className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            consented
              ? 'border-emerald-500/60 bg-emerald-500/40'
              : 'border-slate-600 bg-slate-700/60'
          }`}
        >
          <span
            aria-hidden
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              consented ? 'translate-x-6' : 'translate-x-1'
            } translate-y-0.5`}
          />
          {busy && (
            <Loader2 className="absolute inset-0 m-auto h-3 w-3 animate-spin text-white" aria-hidden />
          )}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
          <div className="uppercase tracking-wide text-white/50">Status</div>
          <div className={consented ? 'text-emerald-300' : 'text-amber-300'}>
            {consentQ.isLoading
              ? '…'
              : consented
              ? 'Enabled — AI generation allowed'
              : 'Disabled — template only'}
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
          <div className="uppercase tracking-wide text-white/50">Daily token cap</div>
          <div className="text-white">{cap.toLocaleString('en-IN')} tokens / day</div>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-[11px] text-red-100 flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-300" aria-hidden />
          <span>{err}</span>
        </div>
      )}

      <p className="text-[10px] text-white/40">
        When enabled, the AI uses your guest's name, dates and party size to draft a
        proposal. Never invents prices or availability. The disclaimer line is always
        included.
      </p>
    </div>
  );
}
