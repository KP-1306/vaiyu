// web/src/lib/dashboardApi.ts
import { supabase } from './supabase';

export interface DashboardMetrics {
    slaPerformance: {
        date: string;
        compliance: number;
        breached: number;
        total: number;
    }[];
    taskVolume: {
        hour: number;
        count: number;
        label: string;
    }[];
    occupancyHistory: {
        date: string;
        occupancyPct: number;
    }[];
    revenueHistory: {
        date: string;
        revenue: number;
    }[];
    todayStats?: {
        occupied: number;
        totalRooms: number;
        arrivals: number;
        departures: number;
        occupancyPct: number;
    };
}

export async function getDashboardMetrics(hotelId: string): Promise<DashboardMetrics> {
    try {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        const [slaResponse, taskResponse, occResponse, revResponse, statsResponse] = await Promise.all([
            supabase.rpc('get_dashboard_sla_trend', {
                p_hotel_id: hotelId,
                p_timezone: timeZone,
                p_days: 7
            }),
            supabase.rpc('get_dashboard_hourly_volume', {
                p_hotel_id: hotelId,
                p_timezone: timeZone
            }),
            supabase.rpc('get_dashboard_occupancy_trend', {
                p_hotel_id: hotelId,
                p_timezone: timeZone,
                p_days: 30
            }),
            supabase.rpc('get_dashboard_revenue_trend', {
                p_hotel_id: hotelId,
                p_timezone: timeZone,
                p_days: 7 // 7-day trend for the mini chart
            }),
            supabase.rpc('get_dashboard_today_stats', {
                p_hotel_id: hotelId,
                p_timezone: timeZone
            })
        ]);

        if (slaResponse.error) console.error("SLA RPC error:", slaResponse.error);
        if (taskResponse.error) console.error("Volume RPC error:", taskResponse.error);
        if (occResponse.error) console.error("Occupancy RPC error:", occResponse.error);
        if (revResponse.error) console.error("Revenue RPC error:", revResponse.error);
        if (statsResponse.error) console.error("Stats RPC error:", statsResponse.error);

        // Process SLA Data
        const slaPerformance = (slaResponse.data || []).map((row: any) => {
            const total = row.total_tickets || 0;
            const breached = row.breached_tickets || 0;
            const compliant = row.compliant_tickets || 0; // or total - breached

            // Compliance calculation
            // If total is 0, we can say 100% or 0% or null. 100% is usually cleaner for "No breaches".
            const compliance = total > 0 ? (compliant / total) * 100 : 100;

            return {
                date: new Date(row.date).toLocaleDateString(undefined, { weekday: 'short' }),
                compliance,
                breached,
                total
            };
        });

        // Process Task Volume Data
        const taskVolume = (taskResponse.data || []).map((row: any) => ({
            hour: row.hour_of_day,
            count: row.ticket_count,
            label: `${row.hour_of_day}:00`
        }));

        // Process Occupancy Data
        const occupancyHistory = (occResponse.data || []).map((row: any) => ({
            date: new Date(row.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
            occupancyPct: row.occupancy_pct || 0
        }));

        // Process Revenue Data
        const revenueHistory = (revResponse.data || []).map((row: any) => ({
            date: new Date(row.date).toLocaleDateString(undefined, { weekday: 'short' }),
            revenue: row.revenue || 0
        }));

        // Process Today Stats
        let todayStats = undefined;
        // 1. Get arrivals/departures from statsResponse
        const statsRow = statsResponse.data?.[0];
        const arrivals = statsRow?.arrivals_count || 0;
        const departures = statsRow?.departures_count || 0;

        // 2. Get current occupancy from the LAST row of occupancyHistory (assuming sorted by date)
        // occResponse.data is ordered by date ASC.
        const lastOccRow = occResponse.data && occResponse.data.length > 0
            ? occResponse.data[occResponse.data.length - 1]
            : null;

        if (lastOccRow) {
            todayStats = {
                occupied: lastOccRow.occupied_count || 0,
                totalRooms: lastOccRow.total_rooms || 0,
                occupancyPct: lastOccRow.occupancy_pct || 0,
                arrivals,
                departures
            };
        }

        return {
            slaPerformance,
            taskVolume,
            occupancyHistory,
            revenueHistory,
            todayStats
        };

    } catch (err) {
        console.warn("Analytics fetch failed, using fallback:", err);
        return {
            slaPerformance: [],
            taskVolume: [],
            occupancyHistory: [],
            revenueHistory: []
        };
    }
}

export async function getRealtimeHousekeepingStatus(hotelId: string) {
    // Logic: count rooms that are clean/inspected
    // For now, we rely on the implementation in OwnerDashboard which approximates it
    // But strictly speaking we should query rooms table here.
    const { data: rooms, error } = await supabase
        .from('rooms')
        .select('id')
        .eq('hotel_id', hotelId);

    if (error) return { total: 0, ready: 0 };

    return {
        total: rooms?.length || 0,
        ready: rooms?.length || 0
    };
}
