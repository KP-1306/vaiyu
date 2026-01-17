import { supa } from './api';

// Get staff historical tickets (completed/cancelled)
export async function getStaffHistory(
    hotelId: string,
    staffMemberId: string,
    filters?: {
        status?: 'COMPLETED' | 'CANCELLED' | 'all';
        dateRange?: 'last7days' | 'last30days' | 'last90days' | 'last12months';
        monthYear?: { month: number; year: number };
        searchQuery?: string;
        cursor?: { completed_at: string; ticket_id: string };
        limit?: number;
    }
) {
    const s = supa();
    if (!s) throw new Error('Not authenticated');

    const limit = filters?.limit || 20;

    // 1. Resolve Search Query (Double-step for performance/syntax)
    let searchRoomIds: string[] = [];
    if (filters?.searchQuery) {
        const { data: rooms } = await s
            .from('rooms')
            .select('id')
            .eq('hotel_id', hotelId)
            .ilike('number', `%${filters.searchQuery}%`);
        if (rooms) {
            searchRoomIds = rooms.map(r => r.id);
        }
    }

    // 2. Query tickets table directly
    let query = s
        .from('tickets')
        .select(`
      id,
      title,
      description,
      status,
      created_at,
      completed_at,
      hotel_id,
      current_assignee_id,
      service_department_id,
      room_id,
      created_by_type,
      rooms(number, floor),
      departments:service_department_id(name)
    `, { count: 'exact' })
        .eq('hotel_id', hotelId)
        .eq('current_assignee_id', staffMemberId)
        .in('status', ['COMPLETED', 'CANCELLED'])
        .order('completed_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false });

    // Status filter
    if (filters?.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
    }

    // Date filters
    if (filters?.monthYear) {
        const { month, year } = filters.monthYear;
        const startOfMonth = new Date(year, month, 1);
        const endOfMonth = new Date(year, month + 1, 1);

        query = query
            .gte('completed_at', startOfMonth.toISOString())
            .lt('completed_at', endOfMonth.toISOString());
    }
    else if (filters?.dateRange) {
        const d = new Date();
        switch (filters.dateRange) {
            case 'last7days': d.setDate(d.getDate() - 7); break;
            case 'last30days': d.setDate(d.getDate() - 30); break;
            case 'last90days': d.setDate(d.getDate() - 90); break;
            case 'last12months': d.setFullYear(d.getFullYear() - 1); break;
        }
        query = query.gte('completed_at', d.toISOString());
    }

    // Search filter (Apply resolved Room IDs OR Title)
    if (filters?.searchQuery) {
        let orFilter = `title.ilike.%${filters.searchQuery}%`;
        if (searchRoomIds.length > 0) {
            orFilter += `,room_id.in.(${searchRoomIds.join(',')})`;
        }
        query = query.or(orFilter);
    }

    // Cursor Pagination Logic
    if (filters?.cursor) {
        const cAt = filters.cursor.completed_at;
        const cId = filters.cursor.ticket_id;
        query = query.or(`completed_at.lt.${cAt},and(completed_at.eq.${cAt},id.lt.${cId})`);
    }

    // Apply Limit
    query = query.limit(limit);

    const { data, error, count } = await query;

    if (error) {
        console.error('getStaffHistory error:', error);
        throw error;
    }

    const rows = data || [];

    // Determine next cursor
    const nextCursor = rows.length > 0 ? {
        completed_at: rows[rows.length - 1].completed_at,
        ticket_id: rows[rows.length - 1].id
    } : null;

    // Transform to match StaffRunnerTicket interface
    const content = rows.map((ticket: any) => ({
        ticket_id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        status: ticket.status,
        created_at: ticket.created_at,
        completed_at: ticket.completed_at,
        room_number: ticket.rooms?.number,
        room_floor: ticket.rooms?.floor,
        department_name: ticket.departments?.name,
        location_label: ticket.rooms?.number ? `Room ${ticket.rooms.number}` : 'Unknown',
        hotel_id: ticket.hotel_id,
        assigned_staff_id: ticket.current_assignee_id,
        assigned_user_id: null,
        assigned_to_name: 'You',
        sla_target_minutes: null,
        sla_remaining_seconds: null,
        sla_breached: null,
        sla_label: null,
        sla_state: 'UNKNOWN' as const,
        active_work_seconds: null,
        blocked_seconds: null,
        requested_by: ticket.created_by_type || 'GUEST',
        allowed_actions: 'NONE'
    }));

    return {
        tickets: content,
        nextCursor: rows.length < limit ? null : nextCursor,
        totalCount: count || 0
    };
}
