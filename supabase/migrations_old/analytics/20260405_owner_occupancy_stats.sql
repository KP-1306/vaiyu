-- ============================================================
-- VIEW: v_owner_occupancy_stats
-- Live room occupancy and guest check-in metrics
-- Uses rooms.status (physical room state) for accurate occupancy
-- ============================================================

DROP VIEW IF EXISTS v_owner_occupancy_stats;

CREATE OR REPLACE VIEW v_owner_occupancy_stats AS
SELECT 
    r.hotel_id,
    COUNT(*) AS total_rooms,
    COUNT(*) FILTER (WHERE r.status = 'occupied') AS occupied_rooms,
    CASE 
        WHEN COUNT(*) > 0 THEN 
            ROUND((COUNT(*) FILTER (WHERE r.status = 'occupied')::numeric / COUNT(*)::numeric) * 100, 2)
        ELSE 0 
    END AS occupancy_percent,
    COALESCE(ct.check_ins_today, 0) AS check_ins_today,
    COALESCE(cy.check_ins_yesterday, 0) AS check_ins_yesterday
FROM rooms r
LEFT JOIN (
    SELECT hotel_id, COUNT(*) AS check_ins_today
    FROM stays
    WHERE scheduled_checkin_at::date = current_date
    GROUP BY hotel_id
) ct ON ct.hotel_id = r.hotel_id
LEFT JOIN (
    SELECT hotel_id, COUNT(*) AS check_ins_yesterday
    FROM stays
    WHERE scheduled_checkin_at::date = current_date - interval '1 day'
    GROUP BY hotel_id
) cy ON cy.hotel_id = r.hotel_id
WHERE r.is_out_of_order = false OR r.is_out_of_order IS NULL
GROUP BY r.hotel_id, ct.check_ins_today, cy.check_ins_yesterday;

GRANT SELECT ON v_owner_occupancy_stats TO authenticated, service_role;
