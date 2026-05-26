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

function buildQueryMock(result: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  const chain = ['select', 'eq', 'order'];
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
  it('queries rooms + pricing_current_rates and merges client-side', async () => {
    const roomsMock = buildQueryMock({
      data: [
        { id: 'R1', number: '101', room_type_id: 'RT1', room_types: { name: 'Deluxe' } },
        { id: 'R2', number: '102', room_type_id: 'RT2', room_types: { name: 'Suite' } },
      ],
      error: null,
    });
    const pricesMock = buildQueryMock({
      data: [
        { room_type_id: 'RT1', base_price: 2000, override_price: 2500 },
        { room_type_id: 'RT2', base_price: 4000, override_price: 4500 },
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

  it('defaults rate to 0 when no pricing entry exists for room_type', async () => {
    const roomsMock = buildQueryMock({
      data: [{ id: 'R1', number: '101', room_type_id: 'RT99', room_types: { name: 'Untracked' } }],
      error: null,
    });
    const pricesMock = buildQueryMock({ data: [], error: null });
    fromBuilderMock.mockReturnValueOnce(roomsMock).mockReturnValueOnce(pricesMock);

    const result = await listRoomsForHotel('H1');
    expect(result[0].default_rate).toBe(0);
  });

  it('ignores property-level rates (null room_type_id)', async () => {
    const roomsMock = buildQueryMock({
      data: [{ id: 'R1', number: '101', room_type_id: 'RT1', room_types: { name: 'Deluxe' } }],
      error: null,
    });
    const pricesMock = buildQueryMock({
      data: [
        { room_type_id: null, base_price: 1000, override_price: 1000 }, // property-level — ignored
        { room_type_id: 'RT1', base_price: 2000, override_price: 2500 },
      ],
      error: null,
    });
    fromBuilderMock.mockReturnValueOnce(roomsMock).mockReturnValueOnce(pricesMock);

    const result = await listRoomsForHotel('H1');
    expect(result[0].default_rate).toBe(2500);
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

  it('throws LeadServiceError when rooms query fails', async () => {
    const roomsMock = buildQueryMock({
      data: null,
      error: { message: 'connection lost' },
    });
    fromBuilderMock.mockReturnValueOnce(roomsMock).mockReturnValueOnce(buildQueryMock({ data: [], error: null }));

    await expect(listRoomsForHotel('H1')).rejects.toBeInstanceOf(LeadServiceError);
  });

  it('throws LeadServiceError when pricing query fails', async () => {
    fromBuilderMock
      .mockReturnValueOnce(buildQueryMock({ data: [], error: null }))
      .mockReturnValueOnce(buildQueryMock({ data: null, error: { message: 'pricing rls' } }));

    await expect(listRoomsForHotel('H1')).rejects.toBeInstanceOf(LeadServiceError);
  });
});
