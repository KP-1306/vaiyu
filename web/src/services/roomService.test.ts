import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fromBuilderMock = vi.fn();
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => fromBuilderMock(table),
  },
}));
vi.mock('../lib/monitoring', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { listRoomsForHotel } from './roomService';
import { LeadServiceError } from './leadService';

// listRoomsForHotel makes two supabase.from() calls in order:
//   1. from('rooms')                  — the rooms list
//   2. from('v_effective_room_price') — via getEffectivePrices (override-aware
//      resolver: per-type override → property-wide override → rate_plan_prices)
// getEffectivePrices chains .select().eq().in(), so the builder supports `in`.
function buildQueryMock(result: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  const chain = ['select', 'eq', 'order', 'in'];
  for (const m of chain) {
    builder[m] = vi.fn(() => builder as unknown as Record<string, unknown>);
  }
  (builder as unknown as { then: unknown }).then = (
    onFulfilled: (v: typeof result) => unknown,
  ) => Promise.resolve(result).then(onFulfilled);
  return builder;
}

beforeEach(() => {
  fromBuilderMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('listRoomsForHotel', () => {
  it('resolves the effective rate via v_effective_room_price', async () => {
    const roomsMock = buildQueryMock({
      data: [
        { id: 'R1', number: '101', room_type_id: 'RT1', room_types: { name: 'Deluxe' } },
        { id: 'R2', number: '102', room_type_id: 'RT2', room_types: { name: 'Suite' } },
      ],
      error: null,
    });
    const pricesMock = buildQueryMock({
      data: [
        { room_type_id: 'RT1', base_price: 2000, effective_price: 2500, override_scope: 'room_type' },
        { room_type_id: 'RT2', base_price: 4000, effective_price: 4500, override_scope: 'room_type' },
      ],
      error: null,
    });
    fromBuilderMock.mockReturnValueOnce(roomsMock).mockReturnValueOnce(pricesMock);

    const result = await listRoomsForHotel('H1');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 'R1',
      number: '101',
      room_type_id: 'RT1',
      room_type_name: 'Deluxe',
      default_rate: 2500,
    });
    expect(result[1].default_rate).toBe(4500);
  });

  it('defaults rate to 0 when the resolver returns no row for a room_type', async () => {
    const roomsMock = buildQueryMock({
      data: [{ id: 'R1', number: '101', room_type_id: 'RT99', room_types: { name: 'Untracked' } }],
      error: null,
    });
    const pricesMock = buildQueryMock({ data: [], error: null });
    fromBuilderMock.mockReturnValueOnce(roomsMock).mockReturnValueOnce(pricesMock);

    const result = await listRoomsForHotel('H1');
    expect(result[0].default_rate).toBe(0);
  });

  it('applies a property-wide override (resolver returns it as effective_price)', async () => {
    // The resolver folds property-wide overrides into effective_price; the
    // client trusts that number regardless of scope. (Previously this flow
    // ignored property-level rates — that was the bug being fixed.)
    const roomsMock = buildQueryMock({
      data: [{ id: 'R1', number: '101', room_type_id: 'RT1', room_types: { name: 'Deluxe' } }],
      error: null,
    });
    const pricesMock = buildQueryMock({
      data: [
        { room_type_id: 'RT1', base_price: 2000, effective_price: 1800, override_scope: 'property' },
      ],
      error: null,
    });
    fromBuilderMock.mockReturnValueOnce(roomsMock).mockReturnValueOnce(pricesMock);

    const result = await listRoomsForHotel('H1');
    expect(result[0].default_rate).toBe(1800);
  });

  it('handles missing room_types relation gracefully', async () => {
    const roomsMock = buildQueryMock({
      data: [{ id: 'R1', number: '101', room_type_id: 'RT1', room_types: null }],
      error: null,
    });
    const pricesMock = buildQueryMock({ data: [], error: null });
    fromBuilderMock.mockReturnValueOnce(roomsMock).mockReturnValueOnce(pricesMock);

    const result = await listRoomsForHotel('H1');
    expect(result[0].room_type_name).toBe('Unknown type');
  });

  it('throws LeadServiceError when the rooms query fails', async () => {
    const roomsMock = buildQueryMock({
      data: null,
      error: { message: 'connection lost' },
    });
    fromBuilderMock.mockReturnValueOnce(roomsMock);

    await expect(listRoomsForHotel('H1')).rejects.toBeInstanceOf(LeadServiceError);
  });

  it('throws LeadServiceError when the pricing resolver query fails', async () => {
    // Needs a room with a room_type_id so getEffectivePrices actually queries
    // (it short-circuits to {} when the room_type list is empty).
    const roomsMock = buildQueryMock({
      data: [{ id: 'R1', number: '101', room_type_id: 'RT1', room_types: { name: 'Deluxe' } }],
      error: null,
    });
    const pricesMock = buildQueryMock({ data: null, error: { message: 'pricing rls' } });
    fromBuilderMock.mockReturnValueOnce(roomsMock).mockReturnValueOnce(pricesMock);

    await expect(listRoomsForHotel('H1')).rejects.toBeInstanceOf(LeadServiceError);
  });
});
