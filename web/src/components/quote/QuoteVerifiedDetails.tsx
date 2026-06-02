// web/src/components/quote/QuoteVerifiedDetails.tsx
//
// Manual verified details: room type, manual final price, nights, owner
// notes, and the two governance checkboxes.
//
// Optional "suggested base rate" hint: when a room_type_id is picked AND
// the lead has a check-in date, we read the existing rate engine via
// getEffectivePrices() and show its number alongside the manual input.
// Staff still types the final price. The hint is informational only.

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banknote, ClipboardCheck, Lightbulb, ShieldAlert } from 'lucide-react';
import { getEffectivePrices, listRoomTypes, type EffectivePrice } from '../../services/pricingService';
import type { QuoteVerifiedInputs, QuoteLeadSnapshot } from '../../types/quoteDraft';

interface Props {
  hotelId: string;
  verified: QuoteVerifiedInputs;
  onChange: (next: QuoteVerifiedInputs) => void;
  lead: QuoteLeadSnapshot | null;
}

function inr(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export function QuoteVerifiedDetails({ hotelId, verified, onChange, lead }: Props) {
  // Room types
  const roomTypesQ = useQuery({
    queryKey: ['quote-drafts', 'room-types', hotelId],
    queryFn: () => listRoomTypes(hotelId),
    enabled: !!hotelId,
    staleTime: 60_000,
  });

  // Suggested base rate from rate engine — only when we have a room type pick
  const effectivePriceQ = useQuery<Record<string, EffectivePrice>>({
    queryKey: ['quote-drafts', 'effective-price', hotelId, verified.roomTypeId],
    queryFn: () =>
      verified.roomTypeId
        ? getEffectivePrices(hotelId, [verified.roomTypeId])
        : Promise.resolve<Record<string, EffectivePrice>>({}),
    enabled: !!hotelId && !!verified.roomTypeId,
    staleTime: 30_000,
  });

  const suggestedRate = useMemo(() => {
    if (!verified.roomTypeId) return null;
    const row = effectivePriceQ.data?.[verified.roomTypeId];
    if (!row) return null;
    return row.effective_price > 0 ? row.effective_price : null;
  }, [effectivePriceQ.data, verified.roomTypeId]);

  // Auto-keep nights synced from lead dates if the operator hasn't overridden.
  // We don't overwrite a non-zero operator value.
  const [nightsOverridden, setNightsOverridden] = useState(false);
  useEffect(() => {
    if (nightsOverridden) return;
    if (lead?.checkIn && lead?.checkOut) {
      const ms = new Date(lead.checkOut).getTime() - new Date(lead.checkIn).getTime();
      const n = Math.max(0, Math.round(ms / 86_400_000));
      if (n !== verified.nights) onChange({ ...verified, nights: n });
    }
  }, [lead?.checkIn, lead?.checkOut, nightsOverridden, verified, onChange]);

  function patch(p: Partial<QuoteVerifiedInputs>) {
    onChange({ ...verified, ...p });
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-4">
      <h3 className="text-sm font-semibold text-slate-100 inline-flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-emerald-300" aria-hidden />
        Verified details (manual)
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Room type */}
        <Field label="Room type">
          <select
            data-testid="quote-room-type-picker"
            value={verified.roomTypeId ?? ''}
            onChange={(e) => {
              const id = e.target.value || null;
              const name =
                id && roomTypesQ.data
                  ? roomTypesQ.data.find((r) => r.id === id)?.name ?? null
                  : null;
              patch({ roomTypeId: id, roomTypeName: name });
            }}
            className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
          >
            <option value="">— Select room type —</option>
            {(roomTypesQ.data ?? []).map((rt) => (
              <option key={rt.id} value={rt.id}>{rt.name}</option>
            ))}
          </select>
          {roomTypesQ.isError && (
            <p className="mt-1 text-[11px] text-red-300">
              Couldn't load room types: {(roomTypesQ.error as Error).message}
            </p>
          )}
        </Field>

        {/* Nights */}
        <Field label="Nights">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={verified.nights}
            onChange={(e) => {
              setNightsOverridden(true);
              patch({ nights: Math.max(0, Number(e.target.value) || 0) });
            }}
            className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
          />
        </Field>

        {/* Manual price (full row on small screens) */}
        <div className="sm:col-span-2">
          <Field
            label={
              <span className="inline-flex items-center gap-2">
                <Banknote className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
                Final price (typed manually — what you commit to the guest)
              </span>
            }
          >
            <input
              type="text"
              data-testid="quote-manual-price"
              value={verified.manualPriceText}
              onChange={(e) => patch({ manualPriceText: e.target.value })}
              placeholder="e.g. ₹8,500 per room per night (inclusive of breakfast)"
              className="w-full rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
            />
          </Field>

          {suggestedRate !== null && (
            <div className="mt-2 inline-flex items-start gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 text-[11px] text-emerald-200">
              <Lightbulb className="h-3 w-3 mt-0.5 shrink-0" aria-hidden />
              <span>
                Suggested base rate from your rate engine:{' '}
                <span className="font-semibold">{inr(suggestedRate)}</span> per night.
                For reference only — type your final price above.
              </span>
            </div>
          )}
        </div>

        {/* Owner notes */}
        <div className="sm:col-span-2">
          <Field label="Notes to the guest (optional)">
            <textarea
              rows={3}
              value={verified.ownerNotes}
              onChange={(e) => patch({ ownerNotes: e.target.value })}
              placeholder="e.g. Early check-in subject to room readiness, complimentary fruit basket on arrival."
              className="w-full resize-y rounded-md border border-slate-700 bg-[#0B0E14] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
            />
          </Field>
        </div>
      </div>

      {/* Governance checkboxes */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-200 inline-flex items-center gap-1.5">
          <ShieldAlert className="h-3 w-3" aria-hidden />
          Operator approval required before copy
        </div>
        <Checkbox
          checked={verified.availabilityConfirmed}
          onChange={(v) => patch({ availabilityConfirmed: v })}
          label="I verified room type, price and availability manually."
          testId="quote-cb-availability"
        />
        <Checkbox
          checked={verified.termsConfirmed}
          onChange={(v) => patch({ termsConfirmed: v })}
          label="I understand this is a draft proposal, not a confirmed booking."
          testId="quote-cb-terms"
        />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  testId: string;
}) {
  return (
    <label className="flex items-start gap-2 text-xs text-slate-200 cursor-pointer">
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 accent-emerald-500"
      />
      <span>{label}</span>
    </label>
  );
}
