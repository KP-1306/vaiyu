// web/src/services/quoteDraftService.ts
//
// Phase 8B — typed wrapper for the quote_drafts persistence RPCs.
//
// All writes go through SECURITY DEFINER RPCs. Listing is a plain table read
// (RLS gates by hotel_member). Errors map onto QuoteServiceError with stable
// codes so the UI can render targeted messages.

import { supabase } from '../lib/supabase';
import { QUOTE_RENDER_PDF_FN, QUOTE_SEND_FN } from '../config/quoteSend';

export type QuoteDraftStatus =
  | 'DRAFT'
  | 'SENT'
  | 'ACCEPTED'
  | 'EXPIRED'
  | 'WITHDRAWN';

export type QuoteDraftGenerator = 'TEMPLATE' | 'AI';

export interface QuoteDraftRow {
  id: string;
  hotel_id: string;
  lead_id: string | null;
  package_code: string | null;
  room_type_id: string | null;
  manual_price_text: string;
  nights: number;
  inclusions: string[];
  owner_notes: string;
  draft_text: string;
  generated_by: QuoteDraftGenerator;
  ai_model: string | null;
  ai_tokens_in: number | null;
  ai_tokens_out: number | null;
  availability_confirmed: boolean;
  terms_confirmed: boolean;
  status: QuoteDraftStatus;
  status_reason: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  sent_at: string | null;
  sent_channel: string | null;
  expires_at: string | null;
  // ─── Quote-send v1 fields (migration 20260526000006) ──────────────────
  /** Storage path in the `quote-pdfs` bucket. Sign on demand. */
  pdf_storage_path: string | null;
  pdf_generated_at: string | null;
  pdf_byte_size: number | null;
  sent_to_address: string | null;
  sent_notification_id: string | null;
}

export type QuoteServiceErrorCode =
  | 'NOT_AUTHORIZED'
  | 'QUOTE_NOT_FOUND'
  | 'NOT_EDITABLE'
  | 'INVALID_TRANSITION'
  | 'GOVERNANCE_INCOMPLETE'
  | 'DRAFT_TEXT_REQUIRED'
  | 'INVALID_GENERATOR'
  | 'AI_META_REQUIRED'
  | 'CONSENT_REQUIRED'
  | 'LEAD_NOT_FOUND'
  | 'LEAD_HOTEL_MISMATCH'
  | 'HOTEL_NOT_FOUND'
  // ── Quote-send v1 codes ─────────────────────────────────────────────
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'RECIPIENT_REQUIRED'
  | 'INVALID_EMAIL'
  | 'SUBJECT_REQUIRED'
  | 'BODY_REQUIRED'
  | 'ALREADY_SENT'
  | 'RESEND_REQUIRES_SENT'
  | 'RESEND_REASON_REQUIRED'
  | 'WHATSAPP_PENDING_APPROVAL'
  | 'UNSUPPORTED_CHANNEL'
  | 'PDF_GENERATION_FAILED'
  | 'STORAGE_UPLOAD_FAILED'
  | 'SIGN_URL_FAILED'
  | 'RECORD_PDF_FAILED'
  | 'NO_PDF'
  | 'UNKNOWN_ERROR';

export class QuoteServiceError extends Error {
  code: QuoteServiceErrorCode;
  constructor(code: QuoteServiceErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'QuoteServiceError';
  }
}

function parsePostgrestError(err: unknown): QuoteServiceError {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = String((err as { message?: string }).message ?? '');
    const m = msg.match(/^([A-Z][A-Z0-9_]*)/);
    if (m && m[1]) {
      const code = m[1];
      const known: QuoteServiceErrorCode[] = [
        'NOT_AUTHORIZED', 'QUOTE_NOT_FOUND', 'NOT_EDITABLE',
        'INVALID_TRANSITION', 'GOVERNANCE_INCOMPLETE',
        'DRAFT_TEXT_REQUIRED', 'INVALID_GENERATOR', 'AI_META_REQUIRED',
        'CONSENT_REQUIRED', 'LEAD_NOT_FOUND', 'LEAD_HOTEL_MISMATCH',
        'HOTEL_NOT_FOUND',
        'IDEMPOTENCY_KEY_REQUIRED', 'RECIPIENT_REQUIRED', 'INVALID_EMAIL',
        'SUBJECT_REQUIRED', 'BODY_REQUIRED', 'ALREADY_SENT',
        'RESEND_REQUIRES_SENT', 'RESEND_REASON_REQUIRED',
        'WHATSAPP_PENDING_APPROVAL', 'UNSUPPORTED_CHANNEL',
        'PDF_GENERATION_FAILED', 'STORAGE_UPLOAD_FAILED', 'SIGN_URL_FAILED',
        'RECORD_PDF_FAILED', 'NO_PDF',
      ];
      if ((known as string[]).includes(code)) {
        return new QuoteServiceError(code as QuoteServiceErrorCode, msg);
      }
    }
    return new QuoteServiceError('UNKNOWN_ERROR', msg);
  }
  return new QuoteServiceError('UNKNOWN_ERROR', 'Unknown error');
}

// ─── Writes ────────────────────────────────────────────────────────────────

export interface CreateQuoteDraftInput {
  hotelId: string;
  draftText: string;
  generatedBy: QuoteDraftGenerator;
  leadId?: string | null;
  packageCode?: string | null;
  roomTypeId?: string | null;
  manualPriceText?: string;
  nights?: number;
  inclusions?: string[];
  ownerNotes?: string;
  aiModel?: string | null;
  aiTokensIn?: number | null;
  aiTokensOut?: number | null;
  availabilityConfirmed?: boolean;
  termsConfirmed?: boolean;
}

export interface CreateQuoteDraftResult {
  id: string;
  status: QuoteDraftStatus;
}

export async function createQuoteDraft(
  input: CreateQuoteDraftInput,
): Promise<CreateQuoteDraftResult> {
  const { data, error } = await supabase.rpc('create_quote_draft', {
    p_hotel_id: input.hotelId,
    p_draft_text: input.draftText,
    p_generated_by: input.generatedBy,
    p_lead_id: input.leadId ?? null,
    p_package_code: input.packageCode ?? null,
    p_room_type_id: input.roomTypeId ?? null,
    p_manual_price_text: input.manualPriceText ?? '',
    p_nights: input.nights ?? 0,
    p_inclusions: input.inclusions ?? [],
    p_owner_notes: input.ownerNotes ?? '',
    p_ai_model: input.aiModel ?? null,
    p_ai_tokens_in: input.aiTokensIn ?? null,
    p_ai_tokens_out: input.aiTokensOut ?? null,
    p_availability_confirmed: input.availabilityConfirmed ?? false,
    p_terms_confirmed: input.termsConfirmed ?? false,
  });
  if (error) throw parsePostgrestError(error);
  const obj = (data ?? {}) as { id?: string; status?: QuoteDraftStatus };
  if (!obj.id) throw new QuoteServiceError('UNKNOWN_ERROR', 'No id returned');
  return { id: obj.id, status: obj.status ?? 'DRAFT' };
}

export interface UpdateQuoteDraftInput {
  id: string;
  draftText?: string;
  manualPriceText?: string;
  ownerNotes?: string;
  availabilityConfirmed?: boolean;
  termsConfirmed?: boolean;
}

export async function updateQuoteDraft(input: UpdateQuoteDraftInput): Promise<void> {
  const { error } = await supabase.rpc('update_quote_draft', {
    p_id: input.id,
    p_draft_text: input.draftText ?? null,
    p_manual_price_text: input.manualPriceText ?? null,
    p_owner_notes: input.ownerNotes ?? null,
    p_availability_confirmed: input.availabilityConfirmed ?? null,
    p_terms_confirmed: input.termsConfirmed ?? null,
  });
  if (error) throw parsePostgrestError(error);
}

export async function markQuoteDraftSent(id: string, channel?: string | null): Promise<void> {
  const { error } = await supabase.rpc('mark_quote_draft_sent', {
    p_id: id,
    p_channel: channel ?? null,
  });
  if (error) throw parsePostgrestError(error);
}

export async function withdrawQuoteDraft(id: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_quote_draft', {
    p_id: id,
    p_reason: reason ?? null,
  });
  if (error) throw parsePostgrestError(error);
}

// ─── Reads ─────────────────────────────────────────────────────────────────

export async function listQuoteDrafts(
  hotelId: string,
  options: { leadId?: string | null; limit?: number } = {},
): Promise<QuoteDraftRow[]> {
  let q = supabase
    .from('quote_drafts')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('updated_at', { ascending: false })
    .limit(options.limit ?? 25);
  if (options.leadId) q = q.eq('lead_id', options.leadId);
  const { data, error } = await q;
  if (error) throw parsePostgrestError(error);
  return (data ?? []) as QuoteDraftRow[];
}

export async function getQuoteDraft(id: string): Promise<QuoteDraftRow | null> {
  const { data, error } = await supabase
    .from('quote_drafts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw parsePostgrestError(error);
  return (data as QuoteDraftRow | null) ?? null;
}

// ─── Per-hotel AI consent ──────────────────────────────────────────────────

export interface HotelAiConsentState {
  consented: boolean;
  consentedAt: string | null;
  consentedBy: string | null;
  dailyTokenCap: number;
}

export async function getHotelAiConsent(hotelId: string): Promise<HotelAiConsentState> {
  const { data, error } = await supabase
    .from('hotels')
    .select(
      'ai_quote_drafts_consented, ai_quote_drafts_consented_at, ai_quote_drafts_consented_by, ai_quote_daily_token_cap',
    )
    .eq('id', hotelId)
    .maybeSingle();
  if (error) throw parsePostgrestError(error);
  const row = (data ?? {}) as {
    ai_quote_drafts_consented?: boolean;
    ai_quote_drafts_consented_at?: string | null;
    ai_quote_drafts_consented_by?: string | null;
    ai_quote_daily_token_cap?: number;
  };
  return {
    consented: !!row.ai_quote_drafts_consented,
    consentedAt: row.ai_quote_drafts_consented_at ?? null,
    consentedBy: row.ai_quote_drafts_consented_by ?? null,
    dailyTokenCap: Number(row.ai_quote_daily_token_cap ?? 0),
  };
}

export async function setHotelAiConsent(
  hotelId: string,
  consented: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_hotel_ai_quote_consent', {
    p_hotel_id: hotelId,
    p_consented: consented,
  });
  if (error) throw parsePostgrestError(error);
}

// ─── Quote-send v1: PDF render + email send via edge functions ────────────

export interface RenderQuotePdfResult {
  ok: boolean;
  storage_path: string;
  byte_size: number;
  signed_url: string;
  expires_in_sec: number;
}

/**
 * Generate the quote PDF (or regenerate if it already exists) and stamp the
 * storage path back onto quote_drafts. Returns a fresh 7-day signed URL.
 * Operator-callable; service-role bypass not needed because the edge function
 * does all storage writes with service-role internally.
 */
export async function renderQuotePdf(quoteId: string): Promise<RenderQuotePdfResult> {
  const { data, error } = await supabase.functions.invoke<RenderQuotePdfResult>(
    QUOTE_RENDER_PDF_FN,
    { body: { quote_id: quoteId } },
  );
  if (error) throw parsePostgrestError(error);
  if (!data || !data.ok) {
    const code = (data as { code?: string } | null)?.code;
    throw new QuoteServiceError(
      (code as QuoteServiceErrorCode) ?? 'PDF_GENERATION_FAILED',
      'Render failed',
    );
  }
  return data;
}

export interface SendQuoteInput {
  quoteId: string;
  toAddress: string;
  channel?: 'email' | 'whatsapp';   // whatsapp blocked until Meta approval
  customSubject?: string;
  customBodyHtml?: string;
  /** UUID v4 per send-click. Same key short-circuits to existing notification. */
  idempotencyKey: string;
}

export interface SendQuoteResult {
  ok: boolean;
  mode: 'send' | 'resend';
  notification_id: string | null;
  idempotent_hit: boolean;
  quote_status: 'SENT';
  storage_path: string;
  signed_url: string;
  expires_in_sec: number;
}

export async function sendQuote(input: SendQuoteInput): Promise<SendQuoteResult> {
  const { data, error } = await supabase.functions.invoke<SendQuoteResult>(QUOTE_SEND_FN, {
    body: {
      quote_id:          input.quoteId,
      channel:           input.channel ?? 'email',
      to_address:        input.toAddress,
      custom_subject:    input.customSubject,
      custom_body_html:  input.customBodyHtml,
      idempotency_key:   input.idempotencyKey,
      mode:              'send',
    },
  });
  if (error) throw parsePostgrestError(error);
  if (!data || !data.ok) {
    const code = (data as { code?: string } | null)?.code;
    throw new QuoteServiceError(
      (code as QuoteServiceErrorCode) ?? 'UNKNOWN_ERROR',
      'Send failed',
    );
  }
  return data;
}

export interface ResendQuoteInput extends SendQuoteInput {
  /** Required for resend — operator's stated reason (logged to audit). */
  resendReason: string;
}

export async function resendQuote(input: ResendQuoteInput): Promise<SendQuoteResult> {
  if (!input.resendReason?.trim()) {
    throw new QuoteServiceError('RESEND_REASON_REQUIRED');
  }
  const { data, error } = await supabase.functions.invoke<SendQuoteResult>(QUOTE_SEND_FN, {
    body: {
      quote_id:         input.quoteId,
      channel:          input.channel ?? 'email',
      to_address:       input.toAddress,
      custom_subject:   input.customSubject,
      custom_body_html: input.customBodyHtml,
      idempotency_key:  input.idempotencyKey,
      mode:             'resend',
      resend_reason:    input.resendReason.trim(),
    },
  });
  if (error) throw parsePostgrestError(error);
  if (!data || !data.ok) {
    const code = (data as { code?: string } | null)?.code;
    throw new QuoteServiceError(
      (code as QuoteServiceErrorCode) ?? 'UNKNOWN_ERROR',
      'Resend failed',
    );
  }
  return data;
}

export interface QuotePdfStoragePath {
  ok: boolean;
  bucket: string;
  path: string;
  generated_at: string | null;
  byte_size: number | null;
}

/**
 * Returns the storage path of a quote's PDF (no signed URL).
 * Frontend uses this for "Download PDF" — combine with a signed-URL call
 * via supabase.storage.from(bucket).createSignedUrl(path, ttl).
 */
export async function getQuotePdfStoragePath(quoteId: string): Promise<QuotePdfStoragePath | null> {
  const { data, error } = await supabase.rpc('get_quote_pdf_storage_path', {
    p_quote_id: quoteId,
  });
  if (error) throw parsePostgrestError(error);
  const obj = (data ?? {}) as Partial<QuotePdfStoragePath> & { code?: string };
  if (!obj.ok) return null;
  return {
    ok: true,
    bucket: obj.bucket ?? 'quote-pdfs',
    path: obj.path ?? '',
    generated_at: obj.generated_at ?? null,
    byte_size: obj.byte_size ?? null,
  };
}

/**
 * Convenience: turn a storage path into a fresh signed URL via the JS client
 * (uses the caller's JWT + storage RLS policies). Default TTL: 1 hour for
 * download links, much shorter than the 7-day URL embedded in sent emails.
 */
export async function signQuotePdfUrl(
  storagePath: string,
  ttlSec = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('quote-pdfs')
    .createSignedUrl(storagePath, ttlSec);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/**
 * Browser-safe UUID v4 generator for idempotency keys. Uses crypto.randomUUID
 * where available; falls back to a manual hex generator otherwise.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback — RFC 4122 v4 via Math.random (acceptable for non-security use).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
