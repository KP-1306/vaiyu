// web/src/components/leads/LeadConvertRoomPicker.tsx
//
// Multi-select grid of hotel rooms with editable per-room rate.
// Selected rooms appear in the form; rate input shown only when selected.

import { Check } from 'lucide-react';
import type { RoomForPicker } from '../../services/roomService';
import { useOwnerT } from '../../i18n/useOwnerT';

export interface SelectedRoom {
  room_id: string;
  room_type_id: string;
  amount_per_night: number;
}

interface Props {
  rooms: RoomForPicker[];
  selected: Map<string, SelectedRoom>;
  onChange: (next: Map<string, SelectedRoom>) => void;
  rateErrors?: Record<string, string>;
  disabled?: boolean;
}

function formatINR(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

export function LeadConvertRoomPicker({
  rooms,
  selected,
  onChange,
  rateErrors,
  disabled,
}: Props) {
  const t = useOwnerT('owner-leads');
  function toggle(room: RoomForPicker) {
    if (disabled) return;
    const next = new Map(selected);
    if (next.has(room.id)) {
      next.delete(room.id);
    } else {
      next.set(room.id, {
        room_id: room.id,
        room_type_id: room.room_type_id,
        amount_per_night: room.default_rate,
      });
    }
    onChange(next);
  }

  function updateRate(roomId: string, rate: number) {
    const next = new Map(selected);
    const current = next.get(roomId);
    if (!current) return;
    next.set(roomId, { ...current, amount_per_night: rate });
    onChange(next);
  }

  const totalPerNight = Array.from(selected.values()).reduce(
    (sum, r) => sum + (Number.isFinite(r.amount_per_night) ? r.amount_per_night : 0),
    0,
  );

  return (
    <div data-testid="lead-convert-room-picker" className="space-y-3">
      {rooms.length === 0 ? (
        <div className="text-sm text-white/50 italic text-center py-4">
          {t('roomPicker.noRooms', 'No rooms found for this hotel')}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
          {rooms.map((room) => {
            const sel = selected.get(room.id);
            const isSelected = !!sel;
            const rateError = rateErrors?.[room.id];

            return (
              <div
                key={room.id}
                className={`
                  rounded-lg border p-3 transition-colors
                  ${isSelected
                    ? 'border-emerald-500/50 bg-emerald-500/5'
                    : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'}
                `}
              >
                <button
                  type="button"
                  onClick={() => toggle(room)}
                  disabled={disabled}
                  aria-pressed={isSelected}
                  className="w-full flex items-center justify-between text-left disabled:opacity-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white">{t('roomPicker.room', 'Room {{number}}', { number: room.number })}</div>
                    <div className="text-xs text-white/60 truncate">{room.room_type_name}</div>
                    <div className="text-[11px] text-white/40 mt-0.5">
                      {t('roomPicker.default', 'Default {{rate}}', { rate: room.default_rate > 0 ? formatINR(room.default_rate) : '—' })}
                    </div>
                  </div>
                  <div
                    className={`
                      shrink-0 h-5 w-5 rounded ring-1 flex items-center justify-center
                      ${isSelected ? 'bg-emerald-500 ring-emerald-400 text-white' : 'ring-white/20'}
                    `}
                  >
                    {isSelected && <Check className="h-3.5 w-3.5" />}
                  </div>
                </button>

                {isSelected && (
                  <div className="mt-3 pt-3 border-t border-white/10">
                    <label className="block">
                      <span className="block text-[11px] text-white/50 mb-1">
                        {t('roomPicker.ratePerNight', 'Rate per night (₹)')}
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={Number.isFinite(sel.amount_per_night) ? sel.amount_per_night : ''}
                        onChange={(e) => updateRate(room.id, Number(e.target.value))}
                        disabled={disabled}
                        className={`
                          w-full rounded-md border bg-black/30 px-2 py-1 text-sm text-white
                          focus:border-emerald-400 focus:outline-none disabled:opacity-50
                          ${rateError ? 'border-red-500/60' : 'border-white/10'}
                        `}
                      />
                      {rateError && (
                        <span className="block text-[11px] text-red-400 mt-1">{rateError}</span>
                      )}
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-md bg-white/[0.03] px-3 py-2 text-sm">
          <span className="text-white/70">
            {t('roomPicker.selected', '{{count}} rooms selected', { count: selected.size })}
          </span>
          <span className="text-white font-semibold">{t('roomPicker.perNight', '{{amount}}/night', { amount: formatINR(totalPerNight) })}</span>
        </div>
      )}
    </div>
  );
}
