-- Fix reassign_task — three real bugs surfaced during UI testing.
--
-- 1. Case-sensitivity bug:
--      Old body compared `IF v_reason != 'SUPERVISOR_APPROVAL'`, but every
--      caller path (request_supervisor RPC, BlockTask UI, seed data) stores
--      reason_code as lowercase 'supervisor_approval'. So this branch never
--      passed — reassign was 100% broken for the supervisor flow.
--
-- 2. Trust boundary:
--      Old RPC accepted `p_supervisor_id uuid` from the client and ran the
--      role check against THAT id. A caller could pass any other member's id
--      and bypass the role gate. Now we derive the actor from auth.uid()
--      directly; the parameter is preserved for signature compatibility but
--      ignored.
--
-- 3. Role gate too narrow:
--      Old check accepted SUPERVISOR or MANAGER. OWNER and SUPERVISOR are
--      the standard pair for decision actions (see approve_supervisor_request
--      + reject_supervisor_approval + reject_sla_exception in
--      20260609000002). Widening to SUPERVISOR, MANAGER, OWNER for parity.

CREATE OR REPLACE FUNCTION public.reassign_task(
  p_ticket_id uuid,
  p_new_assignee_id uuid,
  p_supervisor_id uuid,           -- accepted but IGNORED; derived from auth.uid()
  p_comment text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_actor_id uuid;
  v_hotel_id uuid;
  v_status text;
  v_reason text;
  v_old_assignee uuid;
BEGIN
  -- 1. Lock the ticket and capture state
  SELECT hotel_id, status, reason_code, current_assignee_id
    INTO v_hotel_id, v_status, v_reason, v_old_assignee
  FROM public.tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found: %', p_ticket_id;
  END IF;

  -- 2. Derive actor from auth.uid() — NEVER trust the caller-supplied id.
  --    Allowed roles: SUPERVISOR, MANAGER, OWNER.
  SELECT hm.id INTO v_actor_id
  FROM public.hotel_members hm
  JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
  JOIN public.hotel_roles hr ON hr.id = hmr.role_id
  WHERE hm.user_id = auth.uid()
    AND hm.hotel_id = v_hotel_id
    AND hm.is_active = TRUE
    AND hr.code IN ('SUPERVISOR', 'MANAGER', 'OWNER')
    AND hr.is_active = TRUE
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not a supervisor/manager/owner for this hotel';
  END IF;

  -- 3. Must be BLOCKED
  IF v_status <> 'BLOCKED' THEN
    RAISE EXCEPTION 'Cannot reassign: ticket is not blocked (status: %)', v_status;
  END IF;

  -- 4. Must be the supervisor-approval block (lowercase — the stored value)
  IF v_reason IS DISTINCT FROM 'supervisor_approval' THEN
    RAISE EXCEPTION 'Cannot reassign: ticket not waiting for supervisor approval (reason: %)',
      COALESCE(v_reason, '(none)');
  END IF;

  -- 5. New assignee must exist + be active in the SAME hotel (tenant isolation)
  IF NOT EXISTS (
    SELECT 1 FROM public.hotel_members
    WHERE id = p_new_assignee_id
      AND hotel_id = v_hotel_id
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'New assignee not found / inactive / wrong hotel: %', p_new_assignee_id;
  END IF;

  -- 6. No-op guard
  IF p_new_assignee_id = v_old_assignee THEN
    RAISE EXCEPTION 'New assignee must be different from current assignee';
  END IF;

  -- 7. Update assignment + status (triggers handle SLA resume)
  UPDATE public.tickets
    SET current_assignee_id = p_new_assignee_id,
        status = 'IN_PROGRESS',
        reason_code = NULL,
        updated_at = NOW()
  WHERE id = p_ticket_id;

  -- 8a. REASSIGNED event
  INSERT INTO public.ticket_events (
    ticket_id, event_type, previous_status, new_status, actor_type, actor_id, comment, created_at
  ) VALUES (
    p_ticket_id, 'REASSIGNED', 'BLOCKED', 'IN_PROGRESS',
    'STAFF', v_actor_id,
    format('Reassigned from %s to %s. %s',
      COALESCE(v_old_assignee::text, 'unassigned'),
      p_new_assignee_id::text,
      COALESCE(p_comment, '')),
    NOW()
  );

  -- 8b. UNBLOCKED event — matches v_ops_board_tickets resolution clause
  --     (UNBLOCKED + reason='supervisor_request_cancelled' clears the
  --     pending-block-action lateral join). Use that reason_code so the
  --     Decision Queue clears after reassign too.
  INSERT INTO public.ticket_events (
    ticket_id, event_type, reason_code, previous_status, new_status, actor_type, actor_id, created_at
  ) VALUES (
    p_ticket_id, 'UNBLOCKED', 'supervisor_request_cancelled',
    'BLOCKED', 'IN_PROGRESS', 'STAFF', v_actor_id, NOW()
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'ticket_id', p_ticket_id,
    'new_assignee_id', p_new_assignee_id,
    'old_assignee_id', v_old_assignee,
    'status', 'IN_PROGRESS'
  );
END;
$$;
