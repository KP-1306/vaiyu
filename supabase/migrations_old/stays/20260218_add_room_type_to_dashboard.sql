-- Add room_type_ids array to dashboard rows for client-side filtering
-- Optimized version: Combines HK ETA and Room Type aggregation
-- ============================================================

-- Housekeeping ETA Layer (Aggregated by Room)
CREATE OR REPLACE VIEW v_arrival_housekeeping_eta AS
SELECT
    room_id,
    MIN(estimated_completion_at) AS estimated_completion_at,
    MIN(GREATEST(EXTRACT(EPOCH FROM (estimated_completion_at - now()))/60, 0)) AS minutes_remaining
FROM housekeeping_tasks
WHERE status = 'in_progress'
GROUP BY room_id;

-- Final Unified Row View (UI Consumes This)
CREATE OR REPLACE VIEW v_arrival_dashboard_rows AS
SELECT
    a.*,
    COALESCE(p.payment_pending, false) as payment_pending,
    COALESCE(p.pending_amount, 0) as pending_amount,
    l.arrival_badge,
    COALESCE(l.vip_flag, false) as vip_flag,
    hk.cleaning_minutes_remaining,
    COALESCE(hk.room_type_ids, '{}'::uuid[]) AS room_type_ids,
    hk.room_numbers
FROM v_owner_arrivals_dashboard a
LEFT JOIN v_arrival_payment_state p ON p.booking_id = a.booking_id
LEFT JOIN v_arrival_guest_labels l ON l.booking_id = a.booking_id
LEFT JOIN (
    SELECT 
        booking_id,
        MIN(cleaning_minutes_remaining) AS cleaning_minutes_remaining,
        array_agg(DISTINCT room_type_id) FILTER (WHERE room_type_id IS NOT NULL) AS room_type_ids,
        string_agg(DISTINCT room_number, ', ') FILTER (WHERE room_number IS NOT NULL) AS room_numbers
    FROM (
        -- From booking_rooms (Expected/Reserved)
        SELECT 
            br.booking_id,
            h.minutes_remaining AS cleaning_minutes_remaining,
            br.room_type_id,
            r.number AS room_number
        FROM booking_rooms br
        LEFT JOIN rooms r ON r.id = br.room_id
        LEFT JOIN v_arrival_housekeeping_eta h ON h.room_id = br.room_id
        
        UNION
        
        -- From stays (In-House)
        SELECT 
            s.booking_id,
            NULL::numeric AS cleaning_minutes_remaining,
            r.room_type_id,
            r.number AS room_number
        FROM stays s
        JOIN rooms r ON r.id = s.room_id
        WHERE s.status IN ('arriving', 'inhouse')
    ) combined
    GROUP BY booking_id
) hk ON hk.booking_id = a.booking_id;

GRANT SELECT ON v_arrival_dashboard_rows TO authenticated, service_role;
