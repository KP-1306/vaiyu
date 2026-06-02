// web/src/services/aiQuoteService.ts
//
// Frontend client for the ai-generate-quote Edge Function.

import { supabase } from '../lib/supabase';

export interface GenerateAiQuoteInput {
  hotelId: string;
  leadId?: string | null;
  packageCode?: string | null;
  packageName?: string | null;
  packageDurationNights?: number | null;
  packageInclusions?: string[];
  selectedInclusions?: string[];
  packagePolicyNotes?: string | null;
  roomTypeId?: string | null;
  roomTypeName?: string | null;
  manualPriceText?: string;
  nights?: number;
  ownerNotes?: string;
}

export interface GenerateAiQuoteSuccess {
  ok: true;
  draftText: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  promptVersion: string;
  durationMs: number;
}

export type AiQuoteErrorCode =
  | 'NOT_AUTHENTICATED'
  | 'NOT_AUTHORIZED'
  | 'INVALID_REQUEST'
  | 'HOTEL_NOT_FOUND'
  | 'LEAD_HOTEL_MISMATCH'
  | 'CONSENT_REQUIRED'
  | 'BUDGET_EXCEEDED'
  | 'AI_NOT_CONFIGURED'
  | 'AI_UPSTREAM_ERROR'
  | 'AI_REFUSED'
  | 'RATE_LIMITED'
  | 'METHOD_NOT_ALLOWED'
  | 'UNKNOWN_ERROR';

export interface GenerateAiQuoteFailure {
  ok: false;
  code: AiQuoteErrorCode;
  detail?: string;
}

export type GenerateAiQuoteResult = GenerateAiQuoteSuccess | GenerateAiQuoteFailure;

// Status → code fallback used when the Edge Function returns non-2xx but we
// couldn't parse a JSON body. The Edge Function ALWAYS returns JSON with a
// `code` field today; this map only fires if that contract ever drifts.
const STATUS_TO_CODE: Record<number, AiQuoteErrorCode> = {
  401: 'NOT_AUTHENTICATED',
  403: 'CONSENT_REQUIRED',
  402: 'BUDGET_EXCEEDED',
  404: 'HOTEL_NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  422: 'AI_REFUSED',
  429: 'RATE_LIMITED',
  500: 'UNKNOWN_ERROR',
  502: 'AI_UPSTREAM_ERROR',
};

interface JsonErrorBody {
  ok?: boolean;
  code?: string;
  detail?: string;
}

function bodyToFailure(body: JsonErrorBody | null | undefined): GenerateAiQuoteFailure {
  const code = (body?.code ?? 'UNKNOWN_ERROR') as AiQuoteErrorCode;
  return { ok: false, code, detail: body?.detail };
}

async function readErrorContext(err: unknown): Promise<{
  body: JsonErrorBody | null;
  status: number | null;
}> {
  const e = err as { context?: Response } | null;
  const ctx = e?.context;
  if (!ctx || typeof ctx !== 'object') return { body: null, status: null };
  const status = typeof (ctx as Response).status === 'number' ? (ctx as Response).status : null;
  try {
    // FunctionsHttpError exposes the raw Response; body may still be unread.
    const body = (await (ctx as Response).clone().json()) as JsonErrorBody;
    return { body, status };
  } catch {
    return { body: null, status };
  }
}

export async function generateAiQuote(
  input: GenerateAiQuoteInput,
): Promise<GenerateAiQuoteResult> {
  const invocation = await supabase.functions.invoke('ai-generate-quote', {
    body: {
      hotel_id: input.hotelId,
      lead_id: input.leadId ?? null,
      package_code: input.packageCode ?? null,
      package_name: input.packageName ?? null,
      package_duration_nights: input.packageDurationNights ?? null,
      package_inclusions: input.packageInclusions ?? [],
      selected_inclusions: input.selectedInclusions ?? [],
      package_policy_notes: input.packagePolicyNotes ?? null,
      room_type_id: input.roomTypeId ?? null,
      room_type_name: input.roomTypeName ?? null,
      manual_price_text: input.manualPriceText ?? '',
      nights: input.nights ?? 0,
      owner_notes: input.ownerNotes ?? '',
    },
  });

  const data = invocation.data as JsonErrorBody & {
    draft_text?: string;
    model?: string;
    tokens_in?: number;
    tokens_out?: number;
    prompt_version?: string;
    duration_ms?: number;
  } | null;
  const error = invocation.error;

  // Happy path: data.ok=true. The Edge Function returns JSON for all paths,
  // so success is identified by the explicit flag rather than HTTP status.
  if (!error && data?.ok === true) {
    return {
      ok: true,
      draftText: data.draft_text ?? '',
      model: data.model ?? 'unknown',
      tokensIn: Number(data.tokens_in ?? 0),
      tokensOut: Number(data.tokens_out ?? 0),
      promptVersion: data.prompt_version ?? 'unknown',
      durationMs: Number(data.duration_ms ?? 0),
    };
  }

  // Non-ok response body (Edge Function returned 4xx/5xx with our JSON shape):
  // supabase-js v2 puts the parsed body in `data` AND a FunctionsHttpError in `error`.
  if (data && data.ok === false && data.code) {
    return bodyToFailure(data);
  }

  // Network/transport or non-JSON body — read the underlying Response.
  if (error) {
    const { body, status } = await readErrorContext(error);
    if (body && body.code) return bodyToFailure(body);
    if (status && STATUS_TO_CODE[status]) {
      return { ok: false, code: STATUS_TO_CODE[status], detail: `HTTP ${status}` };
    }
    return { ok: false, code: 'UNKNOWN_ERROR', detail: (error as Error).message };
  }

  return { ok: false, code: 'UNKNOWN_ERROR', detail: 'Empty response from ai-generate-quote' };
}
