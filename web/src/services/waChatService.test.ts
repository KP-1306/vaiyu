// web/src/services/waChatService.test.ts
//
// Parity test: assert that every RPC name and view used by the WhatsApp
// chat service exists in the migrations. Drift between frontend RPC calls
// and SQL function definitions has bitten us before — this test fails
// fast at PR time.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SERVICE = readFileSync(
  resolve(__dirname, './waChatService.ts'),
  'utf8',
);
const MIG_THREADS = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/20260602000002_wa_chat_threads.sql'),
  'utf8',
);
const MIG_ROUTING = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/20260602000003_wa_inbound_routing.sql'),
  'utf8',
);
const ALL_MIG = MIG_THREADS + '\n' + MIG_ROUTING;

const RPC_RE = /supabase\.rpc\(\s*'([a-z_]+)'/g;
const FROM_RE = /\.from\(\s*'([a-z_]+)'/g;

function extractAll(re: RegExp, src: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  // re-anchor a fresh copy because g-flags keep state across runs
  const local = new RegExp(re.source, re.flags);
  while ((m = local.exec(src)) !== null) out.push(m[1]);
  return [...new Set(out)];
}

describe('waChatService — RPC + view name parity with migrations', () => {
  const calledRpcs = extractAll(RPC_RE, SERVICE);
  const queriedTables = extractAll(FROM_RE, SERVICE);

  it('every RPC called by the service is defined in the migrations', () => {
    expect(calledRpcs.length).toBeGreaterThan(0);
    for (const name of calledRpcs) {
      expect(
        ALL_MIG.includes(`FUNCTION public.${name}(`),
        `RPC ${name} called by waChatService is not defined in any 20260602* migration`,
      ).toBe(true);
    }
  });

  it('every table/view queried by the service exists in the migrations', () => {
    // Views may be DROP IF EXISTS + CREATE VIEW; tables may be CREATE TABLE IF NOT EXISTS
    expect(queriedTables.length).toBeGreaterThan(0);
    for (const name of queriedTables) {
      const definedAsTable = ALL_MIG.includes(`TABLE IF NOT EXISTS public.${name}`)
        || ALL_MIG.includes(`TABLE public.${name}`);
      const definedAsView = ALL_MIG.includes(`VIEW public.${name}`);
      expect(
        definedAsTable || definedAsView,
        `Table/view ${name} queried by waChatService is not defined in any 20260602* migration`,
      ).toBe(true);
    }
  });

  it('the four core write RPCs are all wired', () => {
    expect(calledRpcs).toContain('send_chat_message');
    expect(calledRpcs).toContain('mark_chat_thread_read');
    expect(calledRpcs).toContain('assign_chat_thread');
    expect(calledRpcs).toContain('link_ticket_to_chat_thread');
  });

  it('the chat-thread view is queried by listChatThreads', () => {
    expect(queriedTables).toContain('v_chat_threads');
    expect(queriedTables).toContain('wa_chat_messages');
  });
});

// ─── Stable error code parity ──────────────────────────────────────────────

describe('waChatService — stable error codes match SQL RAISE EXCEPTIONS', () => {
  const SERVICE_CODES = [
    'THREAD_NOT_FOUND',
    'NOT_A_MEMBER',
    'NOT_A_MANAGER',
    'BODY_REQUIRED',
    'BODY_TOO_LONG',
    'WINDOW_CLOSED_USE_TEMPLATE',
    'TICKET_NOT_FOUND',
    'CROSS_HOTEL_FORBIDDEN',
  ];

  it.each(SERVICE_CODES)('SQL migrations RAISE EXCEPTION %s', (code) => {
    expect(
      ALL_MIG.includes(`RAISE EXCEPTION '${code}'`),
      `SQL migrations do not raise '${code}' anywhere`,
    ).toBe(true);
  });
});
