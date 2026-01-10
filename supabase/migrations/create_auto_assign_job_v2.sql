-- ============================================================
-- Job: Advanced Auto-Assignment (Production Grade v2.5)
-- Features: Race-safe, Priority-aware, Zone-aware (Soft), Load-balanced
--           Batch Processing (Processes up to 20 tickets/min)
-- Updates:
--   v2.5: Fixes "Head-of-Line Blocking". Iterates through batch
--         so unassignable tickets don't stop the queue.
-- ============================================================

-- 0. Ensure Dependencies
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 1. Add fairness tracking column
ALTER TABLE hotel_members
ADD COLUMN IF NOT EXISTS last_assigned_at TIMESTAMPTZ;

-- 2. Create the robust assignment function
CREATE OR REPLACE FUNCTION auto_assign_next_ticket()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket RECORD;
  v_staff_id UUID;
  v_max_load INT := 20; -- Limit 20 active tickets/person
BEGIN
  -- 🚀 MAJOR CHANGE v2.5:
  -- We fetch the batch UP FRONT.
  -- This ensures correct ordering but allows us to "skip" tickets 
  -- that can't be assigned without stopping the job.
  
  FOR v_ticket IN
    SELECT
      t.id,
      t.hotel_id,
      t.service_department_id,
      t.zone_id,
      t.priority
    FROM tickets t
    LEFT JOIN ticket_sla_state ss
      ON ss.ticket_id = t.id
    WHERE
      t.status = 'NEW'
      AND t.current_assignee_id IS NULL
    ORDER BY
      -- Criticality First:
      CASE
        WHEN ss.current_remaining_seconds IS NOT NULL
             AND ss.current_remaining_seconds <= 300 THEN 0  -- SLA risk (≤5 min)
        ELSE 1
      END,
      -- Then Ticket Priority:
      CASE t.priority
        WHEN 'URGENT' THEN 0
        WHEN 'HIGH' THEN 1
        WHEN 'NORMAL' THEN 2
        WHEN 'LOW' THEN 3
        ELSE 4
      END,
      -- FIFO fallback:
      t.created_at ASC
    LIMIT 20 -- Process batch of 20
    FOR UPDATE OF t SKIP LOCKED -- Lock them all so other workers skip them
  LOOP
    
    ------------------------------------------------------------------
    -- 2️⃣ Select best eligible staff (deterministic & fair)
    ------------------------------------------------------------------
    SELECT hm.id
    INTO v_staff_id
    FROM hotel_members hm
    
    -- ✅ Role Check (Multi-Role Support v2.4)
    JOIN hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
    JOIN hotel_roles hr ON hr.id = hmr.role_id AND hr.code = 'STAFF'

    -- ✅ Must be on active shift
    JOIN staff_shifts ss
      ON ss.staff_id = hm.id
     AND ss.is_active = true
     AND now() BETWEEN ss.shift_start AND ss.shift_end
     
    -- ✅ Must be capable (Department match)
    JOIN staff_departments sd
      ON sd.staff_id = hm.id
     AND sd.department_id = v_ticket.service_department_id
     
    -- ✅ Zone affinity (Soft Preference)
    LEFT JOIN staff_zone_assignments sz
      ON sz.staff_id = hm.id
     AND sz.zone_id = v_ticket.zone_id
     AND sz.effective_to IS NULL
     
    -- ✅ Load calculation
    LEFT JOIN tickets t_load
      ON t_load.current_assignee_id = hm.id
     AND t_load.status IN ('NEW','IN_PROGRESS','BLOCKED')
     
    WHERE
      hm.hotel_id = v_ticket.hotel_id
      AND hm.is_active = true
      AND hm.is_verified = true

    GROUP BY hm.id, sz.id
    HAVING COUNT(t_load.id) < v_max_load
    ORDER BY
      -- 1. Zone Affinity (Soft Preference): Prefer matching zone (0) over mismatch (1)
      CASE 
        WHEN v_ticket.zone_id IS NOT NULL AND sz.id IS NULL THEN 1 
        ELSE 0 
      END ASC,
      -- 2. Fairness/Load:
      COUNT(t_load.id) ASC,                 -- Primary: Least loaded
      hm.last_assigned_at NULLS FIRST,       -- Secondary: Hasn't had a task in longest time
      hm.created_at ASC                      -- Tertiary: Deterministic tie-breaker
    LIMIT 1;

    
    -- 🚀 KEY FIX v2.5:
    -- If no staff found, we DO NOTHING for this ticket.
    -- The loop naturally continues to the NEXT ticket in the batch.
    
    IF v_staff_id IS NOT NULL THEN
      
      ------------------------------------------------------------------
      -- 3️⃣ Assign ticket
      ------------------------------------------------------------------
      UPDATE tickets
      SET
        current_assignee_id = v_staff_id,
        updated_at = clock_timestamp()
      WHERE id = v_ticket.id;

      ------------------------------------------------------------------
      -- 4️⃣ Record assignment event
      ------------------------------------------------------------------
      INSERT INTO ticket_events (
        ticket_id,
        event_type,
        actor_type,
        actor_id,
        comment
      )
      VALUES (
        v_ticket.id,
        'ASSIGNED',
        'SYSTEM',
        v_staff_id, 
        'Auto-assigned by scheduler'
      );

      ------------------------------------------------------------------
      -- 5️⃣ Update staff fairness marker
      ------------------------------------------------------------------
      UPDATE hotel_members
      SET last_assigned_at = clock_timestamp()
      WHERE id = v_staff_id;

    END IF;
    
  END LOOP;
END;
$$;


-- 3. Schedule the job (Run every minute)
SELECT cron.schedule(
  'auto-assign-next-ticket',
  '* * * * *',
  'SELECT public.auto_assign_next_ticket()'
);
