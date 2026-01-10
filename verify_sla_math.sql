-- ============================================================
-- 🔬 SLA MATH INSPECTOR
-- See exactly how the "Frozen Timer" works
-- ============================================================

SELECT 
    t.title,
    t.status,
    
    -- 1. The Inputs
    sp.target_minutes,
    ss.sla_started_at,
    ss.sla_paused_at,
    ss.total_paused_seconds AS history_paused_seconds,
    
    -- 2. Live Math (How the view works)
    EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_started_at))::INT 
        AS total_wall_time_elapsed,
        
    CASE 
        WHEN ss.sla_paused_at IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (clock_timestamp() - ss.sla_paused_at))::INT
        ELSE 0 
    END AS current_pause_duration,
    
    -- 3. The Result
    v.sla_remaining_seconds AS final_remaining_seconds,
    v.sla_label

FROM tickets t
JOIN ticket_sla_state ss ON ss.ticket_id = t.id
JOIN v_staff_runner_tickets v ON v.ticket_id = t.id
JOIN sla_policies sp ON sp.department_id = t.service_department_id
WHERE t.status IN ('IN_PROGRESS', 'BLOCKED')
ORDER BY t.updated_at DESC;
