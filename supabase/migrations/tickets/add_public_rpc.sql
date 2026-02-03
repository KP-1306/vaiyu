-- RPC: Get Ticket Details (Public Tracker)
-- This allows guests to view specific ticket details by Display ID without exposing the whole table.
CREATE OR REPLACE FUNCTION get_ticket_details(p_display_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'id', t.id,
    'display_id', t.display_id,
    'status', t.status,
    'created_at', t.created_at,
    'description', t.description,
    'sla_started_at', tss.sla_started_at,
    'service', jsonb_build_object(
      'label', s.label,
      'sla_minutes', s.sla_minutes,
      'description_en', s.description_en
    ),
    'room', CASE WHEN r.id IS NOT NULL THEN jsonb_build_object('number', r.number) ELSE null END
  ) INTO v_result
  FROM tickets t
  JOIN services s ON s.id = t.service_id
  LEFT JOIN rooms r ON r.id = t.room_id
  LEFT JOIN ticket_sla_state tss ON tss.ticket_id = t.id
  WHERE t.display_id = p_display_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_ticket_details(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION get_ticket_details(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ticket_details(TEXT) TO service_role;
