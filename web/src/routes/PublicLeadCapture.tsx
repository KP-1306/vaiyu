// web/src/routes/PublicLeadCapture.tsx
//
// Public-facing lead-capture page. URL: /p/:hotelSlug/enquire
// No auth required. Resolves slug → hotel_id, then POSTs to the
// leads-public-capture Edge Function.

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle, AlertCircle, Send, Tent } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LanguageToggle } from '../i18n/LanguageToggle';
import { getPackagePublic } from '../services/packageService';
import type { PublicPackagePayload } from '../types/package';

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
  const { t } = useTranslation('publicEnquiry');
  const { hotelSlug } = useParams<{ hotelSlug: string }>();
  const [searchParams] = useSearchParams();
  const packageSlug = searchParams.get('package');
  const utmSource = searchParams.get('utm_source');
  const [hotel, setHotel] = useState<HotelLite | null>(null);
  const [hotelError, setHotelError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [mode, setMode] = useState<SubmitMode>({ kind: 'idle' });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [packageContext, setPackageContext] = useState<PublicPackagePayload | null>(null);

  // Optional package context — pre-fills notes + attributes source_detail
  useEffect(() => {
    if (!hotelSlug || !packageSlug) return;
    let cancelled = false;
    (async () => {
      const payload = await getPackagePublic(hotelSlug, packageSlug);
      if (cancelled || !payload) return;
      setPackageContext(payload);
      setForm((prev) => {
        // Only pre-fill if operator hasn't typed anything yet
        if (prev.notes.trim()) return prev;
        return {
          ...prev,
          notes: `Asked about "${payload.package.name}".`,
          party_adults: Math.max(prev.party_adults, payload.package.min_party_adults),
        };
      });
    })();
    return () => { cancelled = true; };
  }, [hotelSlug, packageSlug]);

  const sourceDetail = useMemo<string | null>(() => {
    if (packageContext) return `Package: ${packageContext.package.name}`;
    if (utmSource) return `utm_source: ${utmSource}`;
    return null;
  }, [packageContext, utmSource]);

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
    if (!form.contact_name.trim()) errors.contact_name = t('validate.nameRequired');
    if (!form.contact_phone.trim() && !form.contact_email.trim()) {
      errors.contact_phone = t('validate.phoneOrEmail');
      errors.contact_email = t('validate.phoneOrEmail');
    }
    if (form.check_in && form.check_out && form.check_out <= form.check_in) {
      errors.check_out = t('validate.checkoutAfter');
    }
    if (form.party_adults < 1) errors.party_adults = t('validate.adultMin');
    if (form.room_count < 1) errors.room_count = t('validate.roomMin');
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
          source_detail: sourceDetail,
        },
      });

      if (error || !data?.ok) {
        const code = data?.code ?? 'UNKNOWN_ERROR';
        // code is a server contract value; map it to a translated message.
        const message = code === 'RATE_LIMITED'
          ? t('submitErr.rateLimited')
          : code === 'INVALID_CONTACT'
          ? t('submitErr.invalidContact')
          : code === 'INVALID_NAME'
          ? t('submitErr.invalidName')
          : code === 'INVALID_DATES'
          ? t('submitErr.invalidDates')
          : code === 'INVALID_REQUEST'
          ? t('submitErr.invalidRequest')
          : t('submitErr.generic');
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
        message: (err as Error).message ?? t('submitErr.network'),
      });
    }
  }

  if (hotelError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0c11] text-white px-4">
        <div className="text-center">
          <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
          <h1 className="text-lg font-semibold mb-1">{t('pageNotFound')}</h1>
          <p className="text-sm text-white/60">{t('hotelNotFound')}</p>
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
          <h1 className="text-xl font-semibold mb-2">{t('thanksTitle')}</h1>
          <p className="text-sm text-white/60">
            {t('thanksBody', { hotel: hotel.name })}
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
        <div className="flex justify-end mb-2">
          <LanguageToggle />
        </div>
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-semibold mb-1">{t('enquireAt', { hotel: hotel.name })}</h1>
          <p className="text-sm text-white/60">
            {t('enquireSub')}
          </p>
          {packageContext && (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
              <Tent className="h-3.5 w-3.5" aria-hidden />
              <span>{t('about', { package: packageContext.package.name })}</span>
            </div>
          )}
        </header>

        <form
          data-testid="public-lead-capture-form"
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5"
        >
          <Field label={t('field.yourName')} required error={fieldErrors.contact_name}>
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
            <Field label={t('field.phone')} error={fieldErrors.contact_phone}>
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
            <Field label={t('field.email')} error={fieldErrors.contact_email}>
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
            <Field label={t('field.checkin')} error={fieldErrors.check_in}>
              <input
                type="date"
                value={form.check_in}
                onChange={(e) => update('check_in', e.target.value)}
                className={inputCls(!!fieldErrors.check_in)}
              />
            </Field>
            <Field label={t('field.checkout')} error={fieldErrors.check_out}>
              <input
                type="date"
                value={form.check_out}
                onChange={(e) => update('check_out', e.target.value)}
                className={inputCls(!!fieldErrors.check_out)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label={t('field.adults')} error={fieldErrors.party_adults}>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={form.party_adults}
                onChange={(e) => update('party_adults', Number(e.target.value) || 1)}
                className={inputCls(!!fieldErrors.party_adults)}
              />
            </Field>
            <Field label={t('field.children')}>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={form.party_children}
                onChange={(e) => update('party_children', Number(e.target.value) || 0)}
                className={inputCls(false)}
              />
            </Field>
            <Field label={t('field.rooms')} error={fieldErrors.room_count}>
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

          <Field label={t('field.anythingElse')}>
            <textarea
              rows={3}
              placeholder={t('notesPlaceholder')}
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
                {t('sending')}
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                {t('sendEnquiry')}
              </>
            )}
          </button>

          <p className="text-[10px] text-white/40 text-center">
            {t('consent', { hotel: hotel.name })}
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
