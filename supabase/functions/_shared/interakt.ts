// supabase/functions/_shared/interakt.ts
//
// Interakt (WhatsApp BSP) send + verify primitives. All HTTP boundaries
// raise typed errors so the dispatcher can map them onto stable codes that
// the notification_queue + audit log can store.
//
// Env vars expected:
//   INTERAKT_API_KEY        — base64(api_key) — paste from Interakt dashboard
//   INTERAKT_BASE_URL       — https://api.interakt.ai (region-specific)
//   INTERAKT_WEBHOOK_SECRET — 32-byte hex for HMAC verification of incoming
//                              webhook calls
//
// Single-platform-account model: one API key serves all hotels.

export class InteraktError extends Error {
  code: InteraktErrorCode;
  status: number;
  providerBody: string;
  constructor(code: InteraktErrorCode, status: number, providerBody: string) {
    super(code);
    this.name = 'InteraktError';
    this.code = code;
    this.status = status;
    this.providerBody = providerBody;
  }
}

export type InteraktErrorCode =
  | 'INTERAKT_AUTH_FAIL'
  | 'INTERAKT_TEMPLATE_NOT_FOUND'
  | 'INTERAKT_TEMPLATE_NOT_APPROVED'
  | 'INTERAKT_INVALID_PHONE'
  | 'INTERAKT_RATE_LIMITED'
  | 'INTERAKT_4XX'
  | 'INTERAKT_5XX'
  | 'INTERAKT_NETWORK'
  | 'INTERAKT_BAD_RESPONSE'
  | 'INTERAKT_WINDOW_CLOSED'
  | 'INTERAKT_CONFIG_MISSING';

// Phone is sent as countryCode + phoneNumber (Interakt's API split).
export function splitE164(e164: string): { countryCode: string; phoneNumber: string } {
  // Strip leading '+' and any non-digits
  const digits = e164.replace(/^\+/, '').replace(/\D/g, '');
  // Best-effort split: try common country codes. For India default to +91.
  // For US/Canada (1), for UK (44), etc.
  // The conservative approach: try 1-3 digit prefixes; default to +91 if 10-digit Indian remains.
  if (digits.length === 12 && digits.startsWith('91')) {
    return { countryCode: '+91', phoneNumber: digits.slice(2) };
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return { countryCode: '+1', phoneNumber: digits.slice(1) };
  }
  if (digits.length === 12 && digits.startsWith('44')) {
    return { countryCode: '+44', phoneNumber: digits.slice(2) };
  }
  if (digits.length === 12 && digits.startsWith('92')) {
    return { countryCode: '+92', phoneNumber: digits.slice(2) };
  }
  // Generic fallback: first 2 digits as country, rest as number
  if (digits.length >= 11) {
    return { countryCode: '+' + digits.slice(0, 2), phoneNumber: digits.slice(2) };
  }
  // Indian 10-digit fallback
  return { countryCode: '+91', phoneNumber: digits };
}

interface InteraktConfig {
  apiKey: string;
  baseUrl: string;
}

function getConfig(): InteraktConfig {
  const apiKey = Deno.env.get('INTERAKT_API_KEY')?.trim();
  const baseUrl = (Deno.env.get('INTERAKT_BASE_URL') ?? 'https://api.interakt.ai').replace(/\/$/, '');
  if (!apiKey) {
    throw new InteraktError('INTERAKT_CONFIG_MISSING', 0, 'INTERAKT_API_KEY env var not set');
  }
  return { apiKey, baseUrl };
}

// ─── Send template message ─────────────────────────────────────────────────
//
// Returns the Interakt messageId on success. Throws InteraktError on any
// failure path with a typed code.

export interface SendTemplateInput {
  phoneE164: string;             // '+919019959870'
  templateName: string;          // Interakt-side template name
  languageCode: string;          // 'en' | 'en_IN' | 'hi' etc.
  headerValues?: string[];       // for templates with header variable
  fileName?: string;             // for media-header templates (URL or attachment id)
  bodyValues: string[];          // ordered positional values
  buttonValues?: Record<string, string[]>;   // {"0": ["url_param"]} for dynamic buttons
  callbackData?: string;         // we set this to notification_queue.id for webhook reconciliation
}

export async function sendInteraktTemplate(
  input: SendTemplateInput,
): Promise<{ messageId: string }> {
  const cfg = getConfig();
  const { countryCode, phoneNumber } = splitE164(input.phoneE164);

  const body: Record<string, unknown> = {
    countryCode,
    phoneNumber,
    callbackData: input.callbackData ?? '',
    type: 'Template',
    template: {
      name: input.templateName,
      languageCode: input.languageCode,
      bodyValues: input.bodyValues,
    },
  };
  if (input.headerValues && input.headerValues.length > 0) {
    (body.template as Record<string, unknown>).headerValues = input.headerValues;
  }
  if (input.fileName) {
    (body.template as Record<string, unknown>).fileName = input.fileName;
  }
  if (input.buttonValues && Object.keys(input.buttonValues).length > 0) {
    (body.template as Record<string, unknown>).buttonValues = input.buttonValues;
  }

  return await sendInteraktRequest('/v1/public/message/', body);
}

// ─── Send free-text (inside 24h session window) ────────────────────────────
//
// Use only when a chat_thread.last_inbound_at is < 24h ago. Outside the
// window, Interakt rejects the call with a status code we re-raise as
// INTERAKT_WINDOW_CLOSED.

export interface SendFreeTextInput {
  phoneE164: string;
  body: string;
  callbackData?: string;
}

export async function sendInteraktFreeText(
  input: SendFreeTextInput,
): Promise<{ messageId: string }> {
  const cfg = getConfig();
  const { countryCode, phoneNumber } = splitE164(input.phoneE164);

  const body = {
    countryCode,
    phoneNumber,
    callbackData: input.callbackData ?? '',
    type: 'Text',
    data: {
      message: input.body,
    },
  };

  return await sendInteraktRequest('/v1/public/message/', body);
}

// ─── Shared low-level POST ─────────────────────────────────────────────────

async function sendInteraktRequest(
  path: string,
  body: Record<string, unknown>,
): Promise<{ messageId: string }> {
  const cfg = getConfig();
  const url = cfg.baseUrl + path;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        // Interakt expects: Authorization: Basic <base64(api_key:)>
        // Their dashboard already provides the base64 string ready to paste.
        Authorization: `Basic ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      // 10s timeout to keep edge functions inside their budget
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new InteraktError('INTERAKT_NETWORK', 0, String(err));
  }

  const responseText = await res.text();
  if (!res.ok) {
    const code: InteraktErrorCode =
      res.status === 401 || res.status === 403 ? 'INTERAKT_AUTH_FAIL' :
      res.status === 429                       ? 'INTERAKT_RATE_LIMITED' :
      res.status >= 500                        ? 'INTERAKT_5XX' :
      // 4xx — try to disambiguate by message text
      /template.*not.*found/i.test(responseText)         ? 'INTERAKT_TEMPLATE_NOT_FOUND' :
      /template.*not.*approved/i.test(responseText)      ? 'INTERAKT_TEMPLATE_NOT_APPROVED' :
      /invalid.*phone|invalid.*number/i.test(responseText) ? 'INTERAKT_INVALID_PHONE' :
      /24.*hour|conversation.*closed|outside.*window/i.test(responseText) ? 'INTERAKT_WINDOW_CLOSED' :
                                                 'INTERAKT_4XX';
    throw new InteraktError(code, res.status, responseText);
  }

  // Parse Interakt's response. Shape varies by template vs free-text;
  // both flavours return an 'id' or 'message.id' or 'result' string.
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new InteraktError('INTERAKT_BAD_RESPONSE', res.status, responseText);
  }
  const messageId =
    (parsed.id as string | undefined) ??
    (parsed.messageId as string | undefined) ??
    (parsed.result as string | undefined) ??
    ((parsed.message as Record<string, unknown> | undefined)?.id as string | undefined) ??
    '';
  if (!messageId) {
    // Some Interakt accounts return { result: true } and a separate webhook delivers the real id.
    // In that case we mint a synthetic id from the response so we have something to write.
    if (parsed.result === true) {
      return { messageId: `interakt_pending_${crypto.randomUUID()}` };
    }
    throw new InteraktError('INTERAKT_BAD_RESPONSE', res.status, responseText);
  }
  return { messageId };
}

// ─── Webhook signature verification ────────────────────────────────────────
//
// Interakt's webhook signs the raw body using HMAC-SHA256 with the secret
// you set in their dashboard. We compare via constant-time equality.

export async function verifyInteraktSignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const secret = Deno.env.get('INTERAKT_WEBHOOK_SECRET')?.trim();
  if (!secret) {
    console.error('INTERAKT_WEBHOOK_SECRET not set');
    return false;
  }
  if (!signatureHeader) return false;

  // Header may be prefixed with "sha256=" or be a bare hex
  const provided = signatureHeader.replace(/^sha256=/i, '').trim().toLowerCase();

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return timingSafeEqualHex(provided, expected);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) {
    r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return r === 0;
}
