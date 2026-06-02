// web/src/routes/owner/QuoteDrafts.tsx
//
// /owner/:slug/quote-drafts — AI Quote Drafts.
//
// Phase 8A: deterministic-template generation, copy-only, no persistence.
// Phase 8B: + "Generate with AI" (Anthropic Claude), persist via
// create_quote_draft RPC, previous-drafts sidebar. Per-hotel AI consent is
// enforced by both the Edge Function and the create RPC.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  FileText,
  Loader2,
  Save,
  Send,
  Sparkles,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  AI_QUOTE_DRAFTS_V0_ENABLED,
  AI_QUOTE_DRAFTS_V1_LIVE_AI,
  buildQuoteDraft,
  emptyForm,
  isApprovalReady,
} from '../../config/quoteDrafts';
import { getLead } from '../../services/leadService';
import { listActivePackages } from '../../services/packageService';
import { packageQueryKeys } from '../../services/packageQueryKeys';
import { resolveQuotePackage } from '../../services/quotePackageAdapter';
import {
  createQuoteDraft,
  getHotelAiConsent,
  markQuoteDraftSent,
  updateQuoteDraft,
  type QuoteDraftRow,
} from '../../services/quoteDraftService';
import { generateAiQuote } from '../../services/aiQuoteService';
import { useQuoteDraftsRealtime } from '../../hooks/useQuoteDraftsRealtime';
import { track } from '../../lib/analytics';
import type { QuoteDraftForm, QuoteLeadSnapshot } from '../../types/quoteDraft';
import {
  QuoteAiGovernanceNotice,
  QuoteDisclaimerBanner,
} from '../../components/quote/QuoteGovernanceBanner';
import { QuoteLeadPicker } from '../../components/quote/QuoteLeadPicker';
import { QuotePackagePicker } from '../../components/quote/QuotePackagePicker';
import { QuoteVerifiedDetails } from '../../components/quote/QuoteVerifiedDetails';
import { QuoteDraftPreview } from '../../components/quote/QuoteDraftPreview';
import { QuotePreviousDrafts } from '../../components/quote/QuotePreviousDrafts';
import { SendQuoteButton } from '../../components/quote/SendQuoteButton';

interface HotelRow {
  id: string;
  name: string;
  slug: string;
}

type AiState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'error'; code: string; detail?: string };

type SaveState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'saved'; id: string; at: number }
  | { kind: 'error'; message: string };

type SentState =
  | { kind: 'idle' }
  | { kind: 'picking' }
  | { kind: 'busy'; channel: string }
  | { kind: 'sent'; channel: string; at: number }
  | { kind: 'error'; message: string };

const SEND_CHANNELS = ['WhatsApp', 'Email', 'Phone', 'In-person', 'Other'] as const;
type SendChannel = (typeof SEND_CHANNELS)[number];

interface AiMeta {
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export default function QuoteDrafts() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();

  const [form, setForm] = useState<QuoteDraftForm>(emptyForm);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [aiState, setAiState] = useState<AiState>({ kind: 'idle' });
  const [aiMeta, setAiMeta] = useState<AiMeta | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [sentState, setSentState] = useState<SentState>({ kind: 'idle' });

  // Resolve hotel
  const hotelQ = useQuery<HotelRow | null>({
    queryKey: ['quote-drafts', 'hotel', slug],
    queryFn: async () => {
      if (!slug) return null;
      const { data, error } = await supabase
        .from('hotels')
        .select('id, name, slug')
        .eq('slug', slug)
        .maybeSingle();
      if (error) throw error;
      return data as HotelRow | null;
    },
    enabled: !!slug,
    staleTime: 60_000,
  });
  const hotel = hotelQ.data ?? null;
  useQuoteDraftsRealtime(hotel?.id);

  // Per-hotel AI consent state
  const consentQ = useQuery({
    queryKey: ['quote-drafts', 'consent', hotel?.id],
    queryFn: () => getHotelAiConsent(hotel!.id),
    enabled: !!hotel?.id,
    staleTime: 30_000,
  });

  // Active+approved Experience Packages for this hotel — feeds the picker
  // and the package resolver used by the template + AI generators.
  const packagesQ = useQuery({
    queryKey: hotel?.id ? packageQueryKeys.active(hotel.id) : ['packages', 'active', 'noop'],
    queryFn: () => (hotel?.id ? listActivePackages(hotel.id) : Promise.resolve([])),
    enabled: !!hotel?.id,
    staleTime: 30_000,
  });
  const realPackages = packagesQ.data ?? [];

  // Pre-select lead from URL ?lead=<uuid>
  const presetLeadId = searchParams.get('lead');
  useEffect(() => {
    let cancelled = false;
    if (!presetLeadId || form.lead?.id === presetLeadId) return;
    (async () => {
      try {
        const lead = await getLead(presetLeadId);
        if (cancelled || !lead) return;
        setForm((prev) => ({
          ...prev,
          lead: {
            id: lead.id,
            name: lead.contact_name,
            partyAdults: lead.party_adults ?? 1,
            partyChildren: lead.party_children ?? 0,
            roomCount: lead.room_count ?? 1,
            checkIn: lead.requested_check_in,
            checkOut: lead.requested_check_out,
            source: lead.source,
            notePreview: lead.latest_note_preview,
          },
        }));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [presetLeadId, form.lead?.id]);

  const handleLeadSelect = useCallback(
    (lead: QuoteLeadSnapshot | null) => {
      setForm((prev) => ({ ...prev, lead, draftDirty: false }));
      setActiveDraftId(null);
      setAiMeta(null);
      setSaveState({ kind: 'idle' });
      setSentState({ kind: 'idle' });
      if (lead?.id) setSearchParams({ lead: lead.id }, { replace: true });
      else setSearchParams({}, { replace: true });
    },
    [setSearchParams],
  );

  const handlePackageSelect = useCallback((code: string | null) => {
    setForm((prev) => ({ ...prev, packageCode: code, draftDirty: false }));
  }, []);

  const handleInclusionsChange = useCallback((next: string[]) => {
    setForm((prev) => ({
      ...prev,
      verified: { ...prev.verified, selectedInclusions: next },
      draftDirty: false,
    }));
  }, []);

  const handleVerifiedChange = useCallback((verified: QuoteDraftForm['verified']) => {
    setForm((prev) => ({ ...prev, verified, draftDirty: false }));
  }, []);

  const handleDraftEdit = useCallback((text: string) => {
    setForm((prev) => ({ ...prev, draftText: text, draftDirty: true }));
    setSaveState({ kind: 'idle' });
  }, []);

  const handleClear = useCallback(() => {
    setForm((prev) => ({ ...prev, draftText: '', draftDirty: false }));
    setAiMeta(null);
    setActiveDraftId(null);
    setSaveState({ kind: 'idle' });
    setSentState({ kind: 'idle' });
    track('quote_draft_cleared', {});
  }, []);

  const handleGenerateTemplate = useCallback(() => {
    const text = buildQuoteDraft({
      lead: form.lead,
      package: resolveQuotePackage(form.packageCode, realPackages),
      verified: form.verified,
    });
    setForm((prev) => ({ ...prev, draftText: text, draftDirty: false }));
    setAiMeta(null);
    setActiveDraftId(null);
    setSaveState({ kind: 'idle' });
    track('quote_draft_generated', {
      generator: 'TEMPLATE',
      has_lead: !!form.lead,
      has_package: !!form.packageCode,
      has_room_type: !!form.verified.roomTypeId,
    });
  }, [form.lead, form.packageCode, form.verified, realPackages]);

  const handleGenerateAi = useCallback(async () => {
    if (!hotel) return;
    setAiState({ kind: 'busy' });
    setSaveState({ kind: 'idle' });
    const pkg = resolveQuotePackage(form.packageCode, realPackages);
    const result = await generateAiQuote({
      hotelId: hotel.id,
      leadId: form.lead?.id ?? null,
      packageCode: form.packageCode,
      packageName: pkg?.name ?? null,
      packageDurationNights: pkg?.durationNights ?? null,
      packageInclusions: pkg?.inclusions ?? [],
      selectedInclusions: form.verified.selectedInclusions,
      packagePolicyNotes: pkg?.policyNotes ?? null,
      roomTypeId: form.verified.roomTypeId,
      roomTypeName: form.verified.roomTypeName,
      manualPriceText: form.verified.manualPriceText,
      nights: form.verified.nights,
      ownerNotes: form.verified.ownerNotes,
    });
    if (!result.ok) {
      setAiState({ kind: 'error', code: result.code, detail: result.detail });
      track('quote_draft_ai_failed', { code: result.code });
      return;
    }
    setAiState({ kind: 'idle' });
    setAiMeta({
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });
    setForm((prev) => ({ ...prev, draftText: result.draftText, draftDirty: false }));
    setActiveDraftId(null);
    track('quote_draft_generated', {
      generator: 'AI',
      model: result.model,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      duration_ms: result.durationMs,
    });
  }, [hotel, form.lead, form.packageCode, form.verified, realPackages]);

  const handleSave = useCallback(async () => {
    if (!hotel) return;
    if (!form.draftText.trim()) return;
    setSaveState({ kind: 'busy' });
    try {
      if (activeDraftId) {
        await updateQuoteDraft({
          id: activeDraftId,
          draftText: form.draftText,
          manualPriceText: form.verified.manualPriceText,
          ownerNotes: form.verified.ownerNotes,
          availabilityConfirmed: form.verified.availabilityConfirmed,
          termsConfirmed: form.verified.termsConfirmed,
        });
        setSaveState({ kind: 'saved', id: activeDraftId, at: Date.now() });
        setForm((prev) => ({ ...prev, draftDirty: false }));
        track('quote_draft_saved', { id: activeDraftId, kind: 'update' });
      } else {
        const created = await createQuoteDraft({
          hotelId: hotel.id,
          draftText: form.draftText,
          generatedBy: aiMeta ? 'AI' : 'TEMPLATE',
          leadId: form.lead?.id ?? null,
          packageCode: form.packageCode,
          roomTypeId: form.verified.roomTypeId,
          manualPriceText: form.verified.manualPriceText,
          nights: form.verified.nights,
          inclusions: form.verified.selectedInclusions,
          ownerNotes: form.verified.ownerNotes,
          aiModel: aiMeta?.model ?? null,
          aiTokensIn: aiMeta?.tokensIn ?? null,
          aiTokensOut: aiMeta?.tokensOut ?? null,
          availabilityConfirmed: form.verified.availabilityConfirmed,
          termsConfirmed: form.verified.termsConfirmed,
        });
        setActiveDraftId(created.id);
        setSaveState({ kind: 'saved', id: created.id, at: Date.now() });
        setForm((prev) => ({ ...prev, draftDirty: false }));
        track('quote_draft_saved', { id: created.id, kind: 'create' });
      }
      qc.invalidateQueries({
        queryKey: ['quote-drafts', 'list', hotel.id],
      });
    } catch (e) {
      const msg = (e as Error).message ?? 'Could not save';
      setSaveState({ kind: 'error', message: msg });
      track('quote_draft_save_failed', { message: msg });
    }
  }, [hotel, form, activeDraftId, aiMeta, qc]);

  const handleMarkSent = useCallback(
    async (channel: SendChannel) => {
      if (!activeDraftId) return;
      setSentState({ kind: 'busy', channel });
      try {
        await markQuoteDraftSent(activeDraftId, channel);
        setSentState({ kind: 'sent', channel, at: Date.now() });
        track('quote_draft_marked_sent', { id: activeDraftId, channel });
        if (hotel?.id) {
          qc.invalidateQueries({ queryKey: ['quote-drafts', 'list', hotel.id] });
        }
      } catch (e) {
        const msg = (e as Error).message ?? 'Could not mark sent';
        setSentState({ kind: 'error', message: msg });
        track('quote_draft_mark_sent_failed', { message: msg });
      }
    },
    [activeDraftId, hotel?.id, qc],
  );

  const handlePickPrevious = useCallback((row: QuoteDraftRow) => {
    setForm({
      lead: null, // we don't have the snapshot rehydrated here; lead picker stays
      packageCode: row.package_code,
      verified: {
        roomTypeId: row.room_type_id,
        roomTypeName: null, // dropdown will resolve from listRoomTypes
        manualPriceText: row.manual_price_text,
        nights: row.nights,
        selectedInclusions: row.inclusions,
        ownerNotes: row.owner_notes,
        availabilityConfirmed: row.availability_confirmed,
        termsConfirmed: row.terms_confirmed,
      },
      draftText: row.draft_text,
      draftDirty: false,
    });
    setActiveDraftId(row.id);
    setAiMeta(
      row.generated_by === 'AI' && row.ai_model
        ? {
            model: row.ai_model,
            tokensIn: row.ai_tokens_in ?? 0,
            tokensOut: row.ai_tokens_out ?? 0,
          }
        : null,
    );
    setSaveState({ kind: 'idle' });
    // Reflect the persisted SENT state if the picked row was already sent.
    if (row.status === 'SENT' && row.sent_channel) {
      setSentState({
        kind: 'sent',
        channel: row.sent_channel,
        at: row.sent_at ? new Date(row.sent_at).getTime() : Date.now(),
      });
    } else {
      setSentState({ kind: 'idle' });
    }
  }, []);

  const approvalReady = useMemo(() => isApprovalReady(form.verified), [form.verified]);
  const liveAiOn = AI_QUOTE_DRAFTS_V1_LIVE_AI && consentQ.data?.consented === true;
  const consentLoaded = consentQ.isSuccess;

  if (!AI_QUOTE_DRAFTS_V0_ENABLED) {
    return (
      <main className="min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200">
        <p className="text-sm text-slate-400">AI Quote Drafts is not enabled.</p>
      </main>
    );
  }

  if (hotelQ.isLoading) {
    return (
      <main className="min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200">
        <Loader2 className="h-5 w-5 animate-spin text-slate-500" aria-hidden />
      </main>
    );
  }

  if (!hotel) {
    return (
      <main className="min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200">
        <div className="text-center max-w-md">
          <p className="text-sm text-slate-300">Hotel not found.</p>
          <button
            type="button"
            onClick={() => navigate('/owner')}
            className="mt-3 inline-flex items-center rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
          >
            Owner Home
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0B0E14] text-slate-200">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6">
        <header className="mb-6 space-y-4">
          <Link
            to={`/owner/${slug ?? ''}`}
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back to dashboard
          </Link>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-emerald-300" aria-hidden />
                <h1 className="text-xl sm:text-2xl font-semibold text-slate-50">
                  AI Quote Drafts
                </h1>
              </div>
              <p className="mt-1 text-sm text-slate-400 max-w-2xl">
                Pick an enquiry, choose a package, type the final price you commit to, and
                generate a draft proposal — by template or by AI. Edit freely, save, and copy
                to send via your usual channel.
              </p>
            </div>
            {consentLoaded && !consentQ.data?.consented && (
              <Link
                to={`/owner/${slug ?? ''}/settings`}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200 hover:bg-amber-500/20"
              >
                AI generation locked — enable in Settings
              </Link>
            )}
          </div>
        </header>

        <QuoteDisclaimerBanner />

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr,1fr]">
          {/* Left column */}
          <section className="space-y-4">
            <QuoteLeadPicker
              hotelId={hotel.id}
              selectedLeadId={form.lead?.id ?? null}
              onSelect={handleLeadSelect}
            />

            {form.lead && (
              <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 text-xs text-slate-300 space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">
                  Selected enquiry
                </div>
                <div className="text-slate-100 font-medium">{form.lead.name}</div>
                <div>
                  Party: {form.lead.partyAdults}A
                  {form.lead.partyChildren > 0 ? `/${form.lead.partyChildren}C` : ''} ·{' '}
                  {form.lead.roomCount} room{form.lead.roomCount === 1 ? '' : 's'}
                </div>
                {form.lead.checkIn && form.lead.checkOut && (
                  <div>
                    Dates: {form.lead.checkIn} → {form.lead.checkOut}
                  </div>
                )}
                <div>Source: {form.lead.source}</div>
                {form.lead.notePreview && (
                  <div className="text-slate-400">Note: {form.lead.notePreview}</div>
                )}
              </div>
            )}

            <QuotePackagePicker
              selectedCode={form.packageCode}
              onSelect={handlePackageSelect}
              selectedInclusions={form.verified.selectedInclusions}
              onInclusionsChange={handleInclusionsChange}
              hotelId={hotel.id}
            />

            <QuoteVerifiedDetails
              hotelId={hotel.id}
              verified={form.verified}
              onChange={handleVerifiedChange}
              lead={form.lead}
            />

            {/* Generator action bar */}
            <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3">
              <p className="text-xs text-slate-400">
                Generate the draft — by deterministic template or by AI. Either way, edit
                before sending.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleGenerateTemplate}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-3.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-800 transition-colors"
                  data-testid="quote-generate-template-button"
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden />
                  Generate from template
                </button>

                <button
                  type="button"
                  onClick={handleGenerateAi}
                  disabled={aiState.kind === 'busy' || !liveAiOn}
                  title={
                    !liveAiOn
                      ? consentLoaded && !consentQ.data?.consented
                        ? 'Owner must enable AI quote drafts in Settings.'
                        : 'AI generation not available.'
                      : 'Generate with Anthropic Claude.'
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3.5 py-2 text-xs font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  data-testid="quote-generate-ai-button"
                >
                  {aiState.kind === 'busy' ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      Generating with AI…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" aria-hidden />
                      Generate with AI
                    </>
                  )}
                </button>

                <div className="flex-1" />

                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!form.draftText.trim() || saveState.kind === 'busy'}
                  className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="quote-save-button"
                >
                  {saveState.kind === 'busy' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : saveState.kind === 'saved' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
                  ) : (
                    <Save className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {saveState.kind === 'saved'
                    ? 'Saved'
                    : activeDraftId
                    ? 'Save changes'
                    : 'Save draft'}
                </button>

                <MarkSentControl
                  activeDraftId={activeDraftId}
                  approvalReady={approvalReady}
                  sentState={sentState}
                  onPick={handleMarkSent}
                  onTogglePicker={() =>
                    setSentState((s) =>
                      s.kind === 'picking' ? { kind: 'idle' } : { kind: 'picking' },
                    )
                  }
                />

                <SendQuoteButton
                  activeDraftId={activeDraftId}
                  approvalReady={approvalReady}
                />
              </div>

              {sentState.kind === 'sent' && (
                <p className="text-[11px] text-emerald-200">
                  <Send className="inline h-3 w-3 mr-1" aria-hidden />
                  Marked sent via <span className="font-medium">{sentState.channel}</span> just now.
                  This records the operator's manual send — VAiyu does not send any message itself.
                </p>
              )}
              {sentState.kind === 'error' && (
                <p className="text-[11px] text-red-300">{sentState.message}</p>
              )}

              {aiMeta && (
                <div className="text-[11px] text-slate-400">
                  <Sparkles className="inline h-3 w-3 text-emerald-300 mr-1" aria-hidden />
                  AI · {aiMeta.model} · {aiMeta.tokensIn + aiMeta.tokensOut} tokens
                </div>
              )}

              {aiState.kind === 'error' && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-100"
                >
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-300" aria-hidden />
                    <div className="space-y-0.5">
                      <p className="font-medium">
                        {aiErrorTitle(aiState.code)}
                      </p>
                      {aiState.detail && <p className="text-red-100/80">{aiState.detail}</p>}
                      {aiState.code === 'CONSENT_REQUIRED' && (
                        <Link
                          to={`/owner/${slug ?? ''}/settings`}
                          className="inline-block mt-1 text-red-200 underline"
                        >
                          Open Settings
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {saveState.kind === 'error' && (
                <p className="text-[11px] text-red-300">{saveState.message}</p>
              )}
            </div>

            <QuoteAiGovernanceNotice />

            <QuotePreviousDrafts
              hotelId={hotel.id}
              leadId={form.lead?.id ?? null}
              activeId={activeDraftId}
              onPick={handlePickPrevious}
            />
          </section>

          {/* Right column */}
          <section>
            <QuoteDraftPreview
              draftText={form.draftText}
              onChange={handleDraftEdit}
              onClear={handleClear}
              approvalReady={approvalReady}
            />
          </section>
        </div>

        <footer className="mt-8 text-[11px] text-slate-500">
          AI Quote Drafts — deterministic template or AI-assisted, both human-edited. No
          messages are sent and no booking is confirmed from this page.
        </footer>
      </div>
    </main>
  );
}

function aiErrorTitle(code: string): string {
  switch (code) {
    case 'CONSENT_REQUIRED':
      return 'AI generation is locked for this hotel.';
    case 'BUDGET_EXCEEDED':
      return 'Daily AI budget reached for this hotel.';
    case 'AI_NOT_CONFIGURED':
      return 'AI provider is not configured on the server.';
    case 'AI_UPSTREAM_ERROR':
      return 'AI provider is currently unreachable.';
    case 'AI_REFUSED':
      return 'AI declined to draft — too little information.';
    case 'RATE_LIMITED':
      return 'Too many requests. Try again in a minute.';
    case 'NOT_AUTHORIZED':
      return 'You are not authorised for this hotel.';
    default:
      return 'AI generation failed.';
  }
}

// ─── MarkSentControl ───────────────────────────────────────────────────────
//
// Records that the operator manually sent the draft through some external
// channel. VAiyu itself sends nothing — this just stamps the row with
// channel + timestamp so the previous-drafts sidebar shows SENT.
//
// Gated by: a saved draft (activeDraftId) + both governance checkboxes.

interface MarkSentControlProps {
  activeDraftId: string | null;
  approvalReady: boolean;
  sentState: SentState;
  onPick: (channel: SendChannel) => void;
  onTogglePicker: () => void;
}

function MarkSentControl({
  activeDraftId,
  approvalReady,
  sentState,
  onPick,
  onTogglePicker,
}: MarkSentControlProps) {
  const sent = sentState.kind === 'sent';
  const busy = sentState.kind === 'busy';
  const picking = sentState.kind === 'picking';
  const disabled = sent || busy || !activeDraftId || !approvalReady;

  const tooltip = !activeDraftId
    ? 'Save the draft first.'
    : !approvalReady
    ? 'Tick both approval checkboxes first.'
    : sent
    ? `Already marked sent via ${sentState.channel}.`
    : 'Record that you sent this draft via your usual channel.';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onTogglePicker}
        disabled={disabled}
        title={tooltip}
        data-testid="quote-mark-sent-button"
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Send className="h-3.5 w-3.5" aria-hidden />
        )}
        {sent ? `Sent (${sentState.channel})` : 'Mark as sent'}
      </button>

      {picking && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-slate-700 bg-[#0F1320] p-2 shadow-xl"
        >
          <p className="px-1 pb-1 text-[10px] uppercase tracking-wide text-slate-500">
            How did you send it?
          </p>
          <div className="flex flex-wrap gap-1">
            {SEND_CHANNELS.map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => onPick(ch)}
                data-testid={`quote-mark-sent-channel-${ch}`}
                className="inline-flex items-center rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-[11px] text-slate-200 hover:bg-emerald-500/15 hover:border-emerald-500/40"
              >
                {ch}
              </button>
            ))}
          </div>
          <p className="mt-2 px-1 text-[10px] text-slate-500">
            VAiyu does not send the message. This just records what you did.
          </p>
        </div>
      )}
    </div>
  );
}
