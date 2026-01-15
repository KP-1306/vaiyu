-- ============================================================
-- View: v_guest_tickets
-- Purpose: Guest-facing view of their service requests
-- Security: RLS-protected (requires policy on tickets table)
-- ============================================================

-- Enable RLS on tickets table (if not already enabled)
-- FORCE ensures RLS applies even to SECURITY DEFINER functions
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets FORCE ROW LEVEL SECURITY;

-- Create RLS policy for guests to view only their own tickets
-- Scoped explicitly to guests for future clarity
CREATE POLICY guest_can_view_own_tickets_only
ON tickets
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM stays s
    WHERE s.id = tickets.stay_id
      AND s.guest_id = auth.uid()
  )
);

CREATE OR REPLACE VIEW v_guest_tickets AS
SELECT
  t.id,
  t.status,
  t.reason_code,  -- For guest-friendly "On Hold" reasons
  t.created_at,
  t.completed_at,
  t.cancelled_at,
  t.description,
  t.stay_id,

  -- Room context (derived from stay)
  r.number AS room_number,

  -- Service context (from department)
  d.name AS service_name,

  -- Zone name if non-room service
  z.name AS zone_name,

  -- Derived location label (UX sugar)
  COALESCE(
    CONCAT('Room ', r.number),
    z.name
  ) AS location_label

FROM tickets t
JOIN stays st
  ON st.id = t.stay_id
  AND st.guest_id = auth.uid()  -- Enforce stay ownership
LEFT JOIN rooms r
  ON r.id = st.room_id
LEFT JOIN departments d
  ON d.id = t.service_department_id
LEFT JOIN hotel_zones z
  ON z.id = t.zone_id

WHERE t.status IN ('NEW','IN_PROGRESS','BLOCKED','COMPLETED','CANCELLED')

ORDER BY t.created_at DESC;

-- Grant access to authenticated users (RLS enforces ownership)
GRANT SELECT ON v_guest_tickets TO authenticated;