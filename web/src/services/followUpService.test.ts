// web/src/services/followUpService.test.ts
//
// Tests focus on error code parsing + the row → FollowUpItem mapper, the two
// places the service does logic. We don't mock Supabase deeply — the integration
// happens against a real database in the route tests.

import { describe, expect, it, vi } from 'vitest';

// Mock the supabase client before importing the service.
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import {
  FollowUpServiceError,
  createFollowUp,
  listFollowUps,
  markFollowUpAddressed,
  markFollowUpBlocked,
  syncFollowUpsFromLeads,
} from './followUpService';
import { supabase } from '../lib/supabase';

const sb = supabase as unknown as {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
};

function mockRpcOnce(result: { data?: unknown; error?: unknown }) {
  sb.rpc.mockResolvedValueOnce(result as never);
}

function mockSelectChain(result: { data?: unknown; error?: unknown }) {
  // Single chainable object: every builder method returns `chain` itself,
  // and `then` resolves with the final result. This mirrors how a real
  // PostgrestFilterBuilder is await-able at any point in the chain.
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'neq', 'in', 'order', 'limit'] as const) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF);
  sb.from.mockReturnValueOnce(chain as never);
}

describe('FollowUpServiceError parsing', () => {
  it('maps known PG error message prefix → typed code', async () => {
    mockRpcOnce({ data: null, error: { message: 'NOT_AUTHORIZED' } });
    await expect(markFollowUpAddressed('11111111-1111-1111-1111-111111111111'))
      .rejects.toBeInstanceOf(FollowUpServiceError);
  });

  it('maps unknown prefix → UNKNOWN_ERROR', async () => {
    mockRpcOnce({ data: null, error: { message: 'SOMETHING_RANDOM happened' } });
    try {
      await markFollowUpAddressed('11111111-1111-1111-1111-111111111111');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(FollowUpServiceError);
      expect((e as FollowUpServiceError).code).toBe('UNKNOWN_ERROR');
    }
  });

  it('preserves message text in thrown error', async () => {
    mockRpcOnce({ data: null, error: { message: 'FOLLOW_UP_NOT_FOUND: row missing' } });
    try {
      await markFollowUpAddressed('11111111-1111-1111-1111-111111111111');
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as FollowUpServiceError).code).toBe('FOLLOW_UP_NOT_FOUND');
      expect((e as FollowUpServiceError).message).toMatch(/row missing/);
    }
  });

  it('maps REASON_REQUIRED on blocked path', async () => {
    mockRpcOnce({ data: null, error: { message: 'REASON_REQUIRED' } });
    try {
      await markFollowUpBlocked('11111111-1111-1111-1111-111111111111', '');
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as FollowUpServiceError).code).toBe('REASON_REQUIRED');
    }
  });
});

describe('createFollowUp', () => {
  it('returns id from RPC payload', async () => {
    mockRpcOnce({ data: { id: 'abc' }, error: null });
    const id = await createFollowUp({
      hotelId: 'h1',
      category: 'DIRECT_ENQUIRY',
      title: 'Test',
    });
    expect(id).toBe('abc');
  });

  it('throws UNKNOWN_ERROR if RPC returns no id', async () => {
    mockRpcOnce({ data: {}, error: null });
    try {
      await createFollowUp({ hotelId: 'h1', category: 'DIRECT_ENQUIRY', title: 'Test' });
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as FollowUpServiceError).code).toBe('UNKNOWN_ERROR');
    }
  });

  it('throws when title missing via RPC', async () => {
    mockRpcOnce({ data: null, error: { message: 'TITLE_REQUIRED' } });
    try {
      await createFollowUp({ hotelId: 'h1', category: 'DIRECT_ENQUIRY', title: '' });
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as FollowUpServiceError).code).toBe('TITLE_REQUIRED');
    }
  });
});

describe('syncFollowUpsFromLeads', () => {
  it('returns ok+created count from RPC payload', async () => {
    mockRpcOnce({ data: { ok: true, created: 7 }, error: null });
    const out = await syncFollowUpsFromLeads('h1');
    expect(out).toEqual({ ok: true, created: 7 });
  });

  it('handles missing payload defaults', async () => {
    mockRpcOnce({ data: null, error: null });
    const out = await syncFollowUpsFromLeads('h1');
    expect(out).toEqual({ ok: false, created: 0 });
  });

  it('throws NOT_AUTHORIZED for non-managers', async () => {
    mockRpcOnce({ data: null, error: { message: 'NOT_AUTHORIZED' } });
    try {
      await syncFollowUpsFromLeads('h1');
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as FollowUpServiceError).code).toBe('NOT_AUTHORIZED');
    }
  });
});

describe('listFollowUps row → item mapper', () => {
  it('converts snake_case DB row to camelCase FollowUpItem', async () => {
    mockSelectChain({
      data: [
        {
          id: 'f1',
          hotel_id: 'h1',
          lead_id: 'l1',
          category: 'DIRECT_ENQUIRY',
          status: 'PENDING',
          priority: 'HIGH',
          title: 'Follow up with Mr Sharma',
          context: 'Stay: 2026-06-10 → 2026-06-12',
          entity_reference: 'lead-l1',
          recommended_manual_action: 'Reply with rates.',
          due_at: '2026-06-01',
          assigned_to: null,
          blocked_reason: null,
          related_ticket_status: null,
          addressed_at: null,
          addressed_by: null,
          addressed_note: null,
          dismissed_at: null,
          dismissed_reason: null,
          source: 'AUTO_LEAD_CREATED',
          created_at: '2026-05-26T00:00:00Z',
          updated_at: '2026-05-26T00:00:00Z',
        },
      ],
      error: null,
    });

    const { items, raw } = await listFollowUps('h1');
    expect(items.length).toBe(1);
    expect(items[0]).toEqual({
      id: 'f1',
      category: 'DIRECT_ENQUIRY',
      status: 'PENDING',
      priority: 'HIGH',
      title: 'Follow up with Mr Sharma',
      context: 'Stay: 2026-06-10 → 2026-06-12',
      entityReference: 'lead-l1',
      dueAt: '2026-06-01',
      assignedTo: null,
      blockedReason: null,
      relatedTicketStatus: null,
      recommendedManualAction: 'Reply with rates.',
    });
    expect(raw[0].source).toBe('AUTO_LEAD_CREATED');
  });

  it('returns empty arrays when DB returns no rows', async () => {
    mockSelectChain({ data: [], error: null });
    const { items, raw } = await listFollowUps('h1');
    expect(items).toEqual([]);
    expect(raw).toEqual([]);
  });

  it('throws typed error when SELECT fails', async () => {
    mockSelectChain({ data: null, error: { message: 'NOT_AUTHORIZED' } });
    try {
      await listFollowUps('h1');
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as FollowUpServiceError).code).toBe('NOT_AUTHORIZED');
    }
  });
});
