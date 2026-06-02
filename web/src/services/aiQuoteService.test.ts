// web/src/services/aiQuoteService.test.ts
//
// Tests for the AI quote-draft client. We mock supabase.functions.invoke so
// the tests do not touch the network or the Edge Function — we are verifying
// the error-mapping contract between the function's response and the typed
// result the UI consumes.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
  },
}));

import { supabase } from '../lib/supabase';
import { generateAiQuote } from './aiQuoteService';

type InvokeMock = ReturnType<typeof vi.fn>;

function getInvokeMock(): InvokeMock {
  return (supabase.functions.invoke as unknown) as InvokeMock;
}

describe('generateAiQuote', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok=true with structured fields on success', async () => {
    getInvokeMock().mockResolvedValueOnce({
      data: {
        ok: true,
        draft_text: 'Dear guest,\n…disclaimer…',
        model: 'claude-haiku-4-5-test',
        tokens_in: 120,
        tokens_out: 380,
        prompt_version: 'quote_v1',
        duration_ms: 750,
      },
      error: null,
    });
    const out = await generateAiQuote({ hotelId: 'h-1' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.draftText).toMatch(/Dear guest/);
      expect(out.model).toBe('claude-haiku-4-5-test');
      expect(out.tokensIn).toBe(120);
      expect(out.tokensOut).toBe(380);
      expect(out.promptVersion).toBe('quote_v1');
    }
  });

  it('maps explicit code from a non-ok body to a typed failure', async () => {
    getInvokeMock().mockResolvedValueOnce({
      data: {
        ok: false,
        code: 'CONSENT_REQUIRED',
        detail: 'Owner must enable AI quote drafts in Settings before this can run.',
      },
      error: null,
    });
    const out = await generateAiQuote({ hotelId: 'h-1' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe('CONSENT_REQUIRED');
      expect(out.detail).toMatch(/Settings/);
    }
  });

  it('returns UNKNOWN_ERROR when both error and data are falsy', async () => {
    getInvokeMock().mockResolvedValueOnce({ data: null, error: null });
    const out = await generateAiQuote({ hotelId: 'h-1' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('UNKNOWN_ERROR');
  });

  // Supabase v2 wraps non-2xx responses: `data` carries the parsed JSON body
  // AND `error` is a FunctionsHttpError. Real Edge Function calls always
  // return a JSON body, so data.code is the primary path.
  it('prefers data.code over HTTP-status fallback when both are present', async () => {
    const ctx = new Response(JSON.stringify({ ok: false, code: 'RATE_LIMITED' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
    getInvokeMock().mockResolvedValueOnce({
      data: { ok: false, code: 'RATE_LIMITED' },
      error: Object.assign(new Error('429 Too Many Requests'), { context: ctx }),
    });
    const out = await generateAiQuote({ hotelId: 'h-1' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('RATE_LIMITED');
  });

  it('falls back to error.context body when data is null', async () => {
    const ctx = new Response(JSON.stringify({ ok: false, code: 'BUDGET_EXCEEDED', detail: 'cap reached' }), {
      status: 402,
      headers: { 'content-type': 'application/json' },
    });
    getInvokeMock().mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('402 Payment Required'), { context: ctx }),
    });
    const out = await generateAiQuote({ hotelId: 'h-1' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe('BUDGET_EXCEEDED');
      expect(out.detail).toBe('cap reached');
    }
  });

  it('falls back to status-code map when neither data nor body is parseable', async () => {
    const ctx = new Response('not json', {
      status: 403,
      headers: { 'content-type': 'text/plain' },
    });
    getInvokeMock().mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('403 Forbidden'), { context: ctx }),
    });
    const out = await generateAiQuote({ hotelId: 'h-1' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('CONSENT_REQUIRED');
  });

  it('returns UNKNOWN_ERROR for transport-level failures without context', async () => {
    getInvokeMock().mockResolvedValueOnce({
      data: null,
      error: new Error('Failed to fetch'),
    });
    const out = await generateAiQuote({ hotelId: 'h-1' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe('UNKNOWN_ERROR');
      expect(out.detail).toMatch(/Failed to fetch/);
    }
  });

  it('forwards optional parameters in the body', async () => {
    const invoke = getInvokeMock();
    invoke.mockResolvedValueOnce({
      data: { ok: true, draft_text: 'x', model: 'm', tokens_in: 1, tokens_out: 1, prompt_version: 'quote_v1', duration_ms: 1 },
      error: null,
    });
    await generateAiQuote({
      hotelId: 'h-1',
      leadId: 'lead-x',
      packageCode: 'family-4n',
      packageName: 'Family — 4N',
      packageDurationNights: 4,
      packageInclusions: ['Breakfast', 'Dinner'],
      selectedInclusions: ['Breakfast'],
      packagePolicyNotes: 'Notes.',
      roomTypeId: 'rt-1',
      roomTypeName: 'Deluxe',
      manualPriceText: '₹8,500',
      nights: 4,
      ownerNotes: 'Special note',
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    const args = invoke.mock.calls[0];
    expect(args[0]).toBe('ai-generate-quote');
    const body = args[1].body;
    expect(body.hotel_id).toBe('h-1');
    expect(body.lead_id).toBe('lead-x');
    expect(body.package_code).toBe('family-4n');
    expect(body.package_inclusions).toEqual(['Breakfast', 'Dinner']);
    expect(body.selected_inclusions).toEqual(['Breakfast']);
    expect(body.room_type_id).toBe('rt-1');
    expect(body.manual_price_text).toBe('₹8,500');
    expect(body.nights).toBe(4);
    expect(body.owner_notes).toBe('Special note');
  });
});
