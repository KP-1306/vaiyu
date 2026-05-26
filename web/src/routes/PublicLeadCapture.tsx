// web/src/routes/PublicLeadCapture.tsx
//
// Public-facing lead-capture page. URL: /p/:hotelSlug/enquire
// No auth required. Resolves slug → hotel_id, then POSTs to the
// leads-public-capture Edge Function.

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, CheckCircle, AlertCircle, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface HotelLite {
  id: string;
  name: string;
}

type SubmitMode =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; possibleDuplicate: boolean }
  | { kind: 'error'; message: string };

interface FormState {
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  check_in: string;
  check_out: string;
  party_adults: number;
  party_children: number;
  room_count: number;
  notes: string;
}

const EMPTY_FORM: FormState = {
  contact_name: '',
  contact_phone: '',
  contact_email: '',
  check_in: '',
  check_out: '',
  party_adults: 2,
  party_children: 0,
  room_count: 1,
  notes: '',
};

export default function PublicLeadCapture() {
  const { hotelSlug } = useParams<{ hotelSlug: string }>();
  const [hotel, setHotel] = useState<HotelLite | null>(null);
  const [hotelError, setHotelError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [mode, setMode] = useState<SubmitMode>({ kind: 'idle' });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Resolve slug → hotel
  useEffect(() => {
    if (!hotelSlug) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('hotels')
        .select('id, name')
        .eq('slug', hotelSlug)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setHotelError('Hotel not found');
        return;
      }
      setHotel(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [hotelSlug]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key as string]) {
      setFieldErrors((prev) => ({ ...prev, [key]: '' }));
    }
  }

  function clientValidate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!form.contact_name.trim()) errors.contact_name = 'Name is required';
    if (!form.contact_phone.trim() && !form.contact_email.trim()) {
      errors.contact_phone = 'Phone or email is required';
      errors.contact_email = 'Phone or email is required';
    }
    if (form.check_in && form.check_out && form.check_out <= form.check_in) {
      errors.check_out = 'Check-out must be after check-in';
    }
    if (form.party_adults < 1) errors.party_adults = 'At least 1 adult required';
    if (form.room_count < 1) errors.room_count = 'At least 1 room required';
    return errors;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hotel) return;
    setMode({ kind: 'submitting' });
    setFieldErrors({});

    const errors = clientValidate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setMode({ kind: 'idle' });
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('leads-public-capture', {
        body: {
          hotel_id: hotel.id,
          source: 'WEBSITE',
          contact_name: form.contact_name.trim(),
          contact_phone: form.contact_phone.trim() || null,
          contact_email: form.contact_email.trim() || null,
          check_in: form.check_in || null,
          check_out: form.check_out || null,
          party_adults: form.party_adults,
          party_children: form.party_children,
          room_count: form.room_count,
          notes: form.notes.trim() || null,
        },
      });

      if (error || !data?.ok) {
        const code = data?.code ?? 'UNKNOWN_ERROR';
        const message = code === 'RATE_LIMITED'
          ? 'Too many requests. Please try again in a few minutes.'
          : code === 'INVALID_CONTACT'
          ? 'Please provide a phone or email so we can reach you.'
          : code === 'INVALID_NAME'
          ? 'Please provide your name.'
          : code === 'INVALID_DATES'
          ? 'Check-out must be after check-in.'
          : code === 'INVALID_REQUEST'
          ? 'Could not submit. Please check your entries.'
          : 'Could not submit. Please try again shortly.';
        setMode({ kind: 'error', message });
        return;
      }

      setMode({
        kind: 'success',
        possibleDuplicate: data.possible_duplicate ?? false,
      });
    } catch (err) {
      setMode({
        kind: 'error',
        message: (err as Error).message ?? 'Network error',
      });
    }
  }

  if (hotelError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0c11] text-white px-4">
        <div className="text-center">
          <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
          <h1 className="text-lg font-semibold mb-1">Page not found</h1>
          <p className="text-sm text-white/60">We couldn't find that hotel.</p>
        </div>
      </div>
    );
  }

  if (!hotel) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0c11] text-white">
        <Loader2 className="h-6 w-6 animate-spin text-white/40" />
      </div>
    );
  }

  if (mode.kind === 'success') {
    return (
      <div
        data-testid="public-lead-capture-success"
        className="min-h-screen flex items-center justify-center bg-[#0a0c11] text-white px-4"
      >
        <div className="max-w-md text-center">
          <div className="rounded-full bg-emerald-500/15 p-3 ring-1 ring-emerald-500/30 inline-flex mb-4">
            <CheckCircle className="h-8 w-8 text-emerald-300" />
          </div>
          <h1 className="text-xl font-semibold mb-2">Thanks — we'll be in touch</h1>
          <p className="text-sm text-white/60">
            We've received your enquiry for {hotel.name}. Our team will reach out shortly.
          </p>
        </div>
      </div>
    );
  }

  const inputCls = (hasErr: boolean) =>
    `w-full rounded-md border bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400 focus:outline-none ${
      hasErr ? 'border-red-500/60' : 'border-white/10'
    }`;

  return (
    <div className="min-h-screen bg-[#0a0c11] text-white">
      <div className="mx-auto max-w-md px-4 py-10">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-semibold mb-1">Enquire at {hotel.name}</h1>
          <p className="text-sm text-white/60">
            Share a few details and we'll get back to you with availability and rates.
          </p>
        </header>

        <form
          data-testid="public-lead-capture-form"
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5"
        >
          <Field label="Your name" required error={fieldErrors.contact_name}>
            <input
              type="text"
              value={form.contact_name}
              onChange={(e) => update('contact_name', e.target.value)}
              autoFocus
              autoComplete="name"
              className={inputCls(!!fieldErrors.contact_name)}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Phone" error={fieldErrors.contact_phone}>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+91 98765 43210"
                value={form.contact_phone}
                onChange={(e) => update('contact_phone', e.target.value)}
                className={inputCls(!!fieldErrors.contact_phone)}
              />
            </Field>
            <Field label="Email" error={fieldErrors.contact_email}>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={form.contact_email}
                onChange={(e) => update('contact_email', e.target.value)}
                className={inputCls(!!fieldErrors.contact_email)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Check-in" error={fieldErrors.check_in}>
              <input
                type="date"
                value={form.check_in}
                onChange={(e) => update('check_in', e.target.value)}
                className={inputCls(!!fieldErrors.check_in)}
              />
            </Field>
            <Field label="Check-out" error={fieldErrors.check_out}>
              <input
                type="date"
                value={form.check_out}
                onChange={(e) => update('check_out', e.target.value)}
                className={inputCls(!!fieldErrors.check_out)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Adults" error={fieldErrors.party_adults}>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={form.party_adults}
                onChange={(e) => update('party_adults', Number(e.target.value) || 1)}
                className={inputCls(!!fieldErrors.party_adults)}
              />
            </Field>
            <Field label="Children">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={form.party_children}
                onChange={(e) => update('party_children', Number(e.target.value) || 0)}
                className={inputCls(false)}
              />
            </Field>
            <Field label="Rooms" error={fieldErrors.room_count}>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={form.room_count}
                onChange={(e) => update('room_count', Number(e.target.value) || 1)}
                className={inputCls(!!fieldErrors.room_count)}
              />
            </Field>
          </div>

          <Field label="Anything else?">
            <textarea
              rows={3}
              placeholder="Special requests, dietary preferences, etc."
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              className={`${inputCls(false)} resize-y`}
            />
          </Field>

          {mode.kind === 'error' && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{mode.message}</span>
            </div>
          )}

          <button
            type="submit"
            data-testid="public-lead-capture-submit"
            disabled={mode.kind === 'submitting'}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mode.kind === 'submitting' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Send enquiry
              </>
            )}
          </button>

          <p className="text-[10px] text-white/40 text-center">
            By submitting, you agree to be contacted by {hotel.name} about your enquiry.
          </p>
        </form>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}

function Field({ label, required, error, children }: FieldProps) {
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
