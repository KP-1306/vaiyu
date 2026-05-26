// web/src/components/leads/LeadConvertModal.tsx
//
// Convert-to-booking modal. Stacks above the LeadDetailDrawer (z-50 over z-40).
// Pre-fills walk-in args from lead context; submits convert_lead_to_walkin RPC.
//
// Three render modes:
//   - 'form': input form
//   - 'success': booking created
//   - 'already-converted': benign duplicate; shows existing booking link

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  X,
  Loader2,
  CheckCircle,
  AlertTriangle,
  ArrowUpRight,
  Info,
} from 'lucide-react';
import type { Lead } from '../../types/lead';
import { convertLeadToWalkin, LeadServiceError } from '../../services/leadService';
import { listRoomsForHotel } from '../../services/roomService';
import { humanizeError } from './LeadQuickAddModal.errorMapping';
import {
  validateConvertInput,
  hasConvertErrors,
  type ConvertValidationErrors,
} from './LeadConvertModal.validation';
import { LeadConvertRoomPicker, type SelectedRoom } from './LeadConvertRoomPicker';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface Props {
  lead: Lead;
  hotelId: string;
  hotelSlug: string;
  isOpen: boolean;
  onClose: () => void;
  showToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
}

type Mode =
  | { kind: 'form' }
  | {
      kind: 'success';
      bookingId: string;
      bookingCode: string;
      promotedThrough: string[];
      latencyMs?: number;
    }
  | {
      kind: 'already-converted';
      existingBookingId: string;
      existingBookingCode: string;
    };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function LeadConvertModal({
  lead,
  hotelId,
  hotelSlug,
  isOpen,
  onClose,
  showToast,
}: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const modalRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<Mode>({ kind: 'form' });

  // Form state
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [selectedRooms, setSelectedRooms] = useState<Map<string, SelectedRoom>>(new Map());
  const [errors, setErrors] = useState<ConvertValidationErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset form whenever modal opens (with fresh lead pre-fill)
  useEffect(() => {
    if (!isOpen) return;
    setGuestName(lead.contact_name);
    setGuestPhone(lead.contact_phone ?? '');
    setGuestEmail(lead.contact_email ?? '');
    setCheckIn(lead.requested_check_in ?? todayISO());
    setCheckOut(lead.requested_check_out ?? tomorrowISO());
    setAdults(Math.max(1, lead.party_adults));
    setChildren(Math.max(0, lead.party_children));
    setSelectedRooms(new Map());
    setErrors({});
    setSubmitError(null);
    setMode({ kind: 'form' });
  }, [isOpen, lead]);

  // Rooms
  const roomsQuery = useQuery({
    queryKey: ['rooms', hotelId],
    queryFn: () => listRoomsForHotel(hotelId),
    enabled: isOpen,
    staleTime: 60_000,
  });

  // Focus trap
  useFocusTrap(modalRef, isOpen);

  // Mutation
  const mutation = useMutation({
    mutationFn: () =>
      convertLeadToWalkin(lead.id, {
        guest_details: {
          full_name: guestName.trim(),
          phone: guestPhone.trim() || undefined,
          email: guestEmail.trim() || undefined,
        },
        room_selections: Array.from(selectedRooms.values()).map((s) => ({
          room_id: s.room_id,
          room_type_id: s.room_type_id,
          amount_per_night: s.amount_per_night,
        })),
        checkin_date: checkIn,
        checkout_date: checkOut,
        adults,
        children,
      }),
    onSuccess: (result) => {
      showToast(`Booking ${result.booking_code} created`, 'success');
      setMode({
        kind: 'success',
        bookingId: result.booking_id,
        bookingCode: result.booking_code,
        promotedThrough: result.promoted_through,
        latencyMs: result.conversion_latency_ms,
      });
      // Refresh lead + events so drawer reflects CONVERTED status
      queryClient.invalidateQueries({ queryKey: ['lead', lead.id] });
      queryClient.invalidateQueries({ queryKey: ['lead-events', lead.id] });
      queryClient.invalidateQueries({ queryKey: ['leads', hotelId] });
      queryClient.invalidateQueries({ queryKey: ['leads-kanban', hotelId] });
    },
    onError: (err) => {
      const lse = err as LeadServiceError;
      if (lse instanceof LeadServiceError && lse.isAlreadyConverted()) {
        setMode({
          kind: 'already-converted',
          existingBookingId: lse.details.existing_booking_id,
          existingBookingCode: lse.details.existing_booking_code,
        });
        return;
      }
      const msg = humanizeError(lse);
      setSubmitError(msg);
      showToast(msg, 'error');
    },
  });

  // Esc closes (only when not submitting)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !mutation.isPending) {
        e.stopPropagation();
        handleClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mutation.isPending]);

  function handleClose() {
    if (mutation.isPending) return;
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const input = {
      guestName,
      guestPhone,
      guestEmail,
      checkIn,
      checkOut,
      adults,
      children,
      selectedRooms: Array.from(selectedRooms.values()),
    };
    const v = validateConvertInput(input);
    if (hasConvertErrors(v)) {
      setErrors(v);
      return;
    }
    setErrors({});
    mutation.mutate();
  }

  function viewBooking(bookingId: string) {
    // No dedicated /owner/:slug/bookings/:id route exists yet — Arrivals shows
    // the just-checked-in walk-in. Use that as the safe target.
    navigate(`/owner/${hotelSlug}/arrivals?focus=${bookingId}`);
    onClose();
  }

  const inputCls = (hasErr: boolean) =>
    `w-full rounded-md border bg-black/30 px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-emerald-400 focus:outline-none disabled:opacity-50 ${
      hasErr ? 'border-red-500/60' : 'border-white/10'
    }`;

  const totalPerNight = useMemo(
    () =>
      Array.from(selectedRooms.values()).reduce(
        (sum, r) => sum + (Number.isFinite(r.amount_per_night) ? r.amount_per_night : 0),
        0,
      ),
    [selectedRooms],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="convert-modal-title"
        data-testid="lead-convert-modal"
        className="w-full sm:max-w-2xl bg-[#101218] sm:rounded-2xl border-t sm:border border-white/10 max-h-[95vh] flex flex-col overflow-hidden"
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <h2 id="convert-modal-title" className="text-base font-semibold text-white">
            {mode.kind === 'success'
              ? 'Booking created'
              : mode.kind === 'already-converted'
              ? 'Already converted'
              : 'Convert to booking'}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={handleClose}
            disabled={mutation.isPending}
            className="p-1 rounded text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {mode.kind === 'success' && (
          <div data-testid="lead-convert-success" className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="flex flex-col items-center text-center py-4">
              <div className="rounded-full bg-emerald-500/15 p-3 ring-1 ring-emerald-500/30 mb-3">
                <CheckCircle className="h-7 w-7 text-emerald-300" />
              </div>
              <div className="text-lg font-semibold text-white">
                Booking {mode.bookingCode}
              </div>
              <div className="text-xs text-white/50 mt-1">
                {mode.promotedThrough.length > 0 && (
                  <>Auto-promoted through {mode.promotedThrough.length} stage{mode.promotedThrough.length === 1 ? '' : 's'} · </>
                )}
                {typeof mode.latencyMs === 'number' && <>Booked in {mode.latencyMs} ms</>}
              </div>
            </div>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-white/70 hover:text-white"
              >
                Done
              </button>
              <button
                type="button"
                data-testid="lead-convert-view-booking"
                onClick={() => viewBooking(mode.bookingId)}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-400"
              >
                View booking
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {mode.kind === 'already-converted' && (
          <div data-testid="lead-convert-already-banner" className="flex-1 overflow-y-auto p-5">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
              <Info className="h-5 w-5 text-amber-300 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-semibold text-amber-100">This lead was already converted</div>
                <div className="text-sm text-amber-200/80 mt-1">
                  Existing booking: <span className="font-mono">{mode.existingBookingCode}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-white/70 hover:text-white"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => viewBooking(mode.existingBookingId)}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-400"
              >
                Open existing booking
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {mode.kind === 'form' && (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Lead context summary */}
            <div className="rounded-md bg-white/[0.02] border border-white/10 px-3 py-2 text-xs text-white/60">
              Converting lead <span className="text-white font-medium">{lead.contact_name}</span>
              {lead.status !== 'WON' && (
                <> · current status <span className="text-white">{lead.status}</span> — will auto-promote</>
              )}
            </div>

            {/* Guest details */}
            <fieldset className="space-y-3">
              <legend className="text-xs font-semibold uppercase tracking-wider text-white/60 mb-2">
                Guest
              </legend>
              <Field label="Name" error={errors.guestName} required>
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  disabled={mutation.isPending}
                  className={inputCls(!!errors.guestName)}
                />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Phone" error={errors.guestPhone}>
                  <input
                    type="tel"
                    inputMode="tel"
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                    disabled={mutation.isPending}
                    className={inputCls(!!errors.guestPhone)}
                  />
                </Field>
                <Field label="Email" error={errors.guestEmail}>
                  <input
                    type="email"
                    inputMode="email"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    disabled={mutation.isPending}
                    className={inputCls(!!errors.guestEmail)}
                  />
                </Field>
              </div>
            </fieldset>

            {/* Stay */}
            <fieldset className="space-y-3">
              <legend className="text-xs font-semibold uppercase tracking-wider text-white/60 mb-2">
                Stay
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Check-in" error={errors.checkIn} required>
                  <input
                    type="date"
                    value={checkIn}
                    onChange={(e) => setCheckIn(e.target.value)}
                    disabled={mutation.isPending}
                    className={inputCls(!!errors.checkIn)}
                  />
                </Field>
                <Field label="Check-out" error={errors.checkOut} required>
                  <input
                    type="date"
                    value={checkOut}
                    onChange={(e) => setCheckOut(e.target.value)}
                    disabled={mutation.isPending}
                    className={inputCls(!!errors.checkOut)}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Adults" error={errors.adults} required>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={adults}
                    onChange={(e) => setAdults(Number(e.target.value) || 1)}
                    disabled={mutation.isPending}
                    className={inputCls(!!errors.adults)}
                  />
                </Field>
                <Field label="Children" error={errors.children}>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={children}
                    onChange={(e) => setChildren(Number(e.target.value) || 0)}
                    disabled={mutation.isPending}
                    className={inputCls(!!errors.children)}
                  />
                </Field>
              </div>
            </fieldset>

            {/* Rooms */}
            <fieldset>
              <legend className="text-xs font-semibold uppercase tracking-wider text-white/60 mb-2">
                Rooms <span className="text-red-400">*</span>
              </legend>
              {roomsQuery.isPending ? (
                <div className="text-sm text-white/40 flex items-center gap-2 py-4">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading rooms…
                </div>
              ) : roomsQuery.isError ? (
                <div className="text-sm text-red-400 py-4">Could not load rooms.</div>
              ) : (
                <LeadConvertRoomPicker
                  rooms={roomsQuery.data ?? []}
                  selected={selectedRooms}
                  onChange={setSelectedRooms}
                  rateErrors={errors.rates}
                  disabled={mutation.isPending}
                />
              )}
              {errors.rooms && (
                <div className="mt-2 text-[11px] text-red-400">{errors.rooms}</div>
              )}
            </fieldset>

            {/* Submission error */}
            {submitError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            {/* Footer */}
            <footer className="flex items-center justify-between gap-2 pt-2 border-t border-white/10">
              <div className="text-xs text-white/50">
                {selectedRooms.size > 0
                  ? `${selectedRooms.size} room${selectedRooms.size === 1 ? '' : 's'} · ₹${totalPerNight}/night`
                  : 'No rooms selected'}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={mutation.isPending}
                  className="px-3 py-2 text-sm text-white/70 hover:text-white disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="lead-convert-submit"
                  disabled={mutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed min-w-[140px] justify-center"
                >
                  {mutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Converting…
                    </>
                  ) : (
                    'Create booking'
                  )}
                </button>
              </div>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}

function Field({ label, error, required, children }: FieldProps) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-white/70 mb-1">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </span>
      {children}
      {error && <span className="block text-[11px] text-red-400 mt-1">{error}</span>}
    </label>
  );
}
