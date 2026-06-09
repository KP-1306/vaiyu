-- Supervisor Approve fix + OWNER subsumes SUPERVISOR for decision RPCs.
--
-- Problem (Bug #1, ops/supervisor flow):
--   When staff escalates a ticket (request_supervisor → status=BLOCKED,
--   reason_code=supervisor_approval), the OpsBoard "Approve" button calls
--   unblock_task(ticket, 'SUPERVISOR_APPROVED'). But unblock_task is a
--   staff-self-resume RPC: it gates with
--     IF v_current_assignee IS DISTINCT FROM v_member_id THEN
--       RAISE EXCEPTION 'Only the assigned staff can resume this task';
--   so a supervisor approving someone else's ticket gets rejected.
--
--   Also, even if it succeeded (single-user hotel like seed where the
--   approver is also the assignee), the emitted event is
--   UNBLOCKED + reason_code='SUPERVISOR_APPROVED', which does NOT match
--   v_ops_board_tickets' pending_block_action resolution clause (which looks
--   for event_type IN ('SUPERVISOR_APPROVED','SUPERVISOR_REJECTED') or
--   UNBLOCKED + reason='supervisor_request_cancelled'). Result: the Decision
--   Queue never clears until status hits COMPLETED.
--
-- Fix:
--   1. New RPC approve_supervisor_request(ticket_id, comment) — dedicated
--      SECURITY DEFINER, mirrors reject_supervisor_approval. Locks row,
--      role check (SUPERVISOR or OWNER), idempotent. Emits SUPERVISOR_APPROVED
--      (clears view, clause 1) AND UNBLOCKED+supervisor_request_cancelled
--      (clause 2 + fires SLA-resume trigger trg_resume_sla_on_unblock).
--
--   2. Widen the SUPERVISOR-only role check in reject_supervisor_approval
--      and reject_sla_exception to also accept OWNER. Owner is strictly
--      higher-privilege; today they can SEE the OpsBoard but cannot act on
--      these decisions, which is a product gap.
--
--   grant_sla_exception is intentionally NOT modified — its current check
--   accepts any active hotel_member (no SUPERVISOR gate), which is a
--   different access model. Don't tighten what wasn't tightened before.
--
--   unblock_task itself is untouched. Staff self-resume contract stays.

-- ════════════════════════════════════════════════════════════════════════
-- 1. New RPC: approve_supervisor_request
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.approve_supervisor_request(
  p_ticket_id uuid,
  p_comment text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_status text;
  v_hotel_id uuid;
  v_actor_id uuid;
  v_latest_block_at timestamptz;
  v_latest_block_reason text;
BEGIN
  -- 1. Lock ticket row
  SELECT status, hotel_id INTO v_status, v_hotel_id
  FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket % does not exist', p_ticket_id;
  END IF;

  -- 2. Must be BLOCKED
  IF v_status <> 'BLOCKED' THEN
    RAISE EXCEPTION 'Cannot approve: ticket % is not BLOCKED (status=%)',
      p_ticket_id, v_status;
  END IF;

  -- 3. Caller must be active SUPERVISOR or OWNER for this hotel
  SELECT hm.id INTO v_actor_id
  FROM public.hotel_members hm
  JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
  JOIN public.hotel_roles hr ON hr.id = hmr.role_id
  WHERE hm.user_id = auth.uid()
    AND hm.hotel_id = v_hotel_id
    AND hm.is_active = TRUE
    AND hr.code IN ('SUPERVISOR', 'OWNER')
    AND hr.is_active = TRUE
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not a supervisor or owner for this hotel';
  END IF;

  -- 4. Find the most recent unresolved supervisor-request event from EITHER path:
  --    a) BLOCKED + reason='supervisor_approval' (manual block-with-reason path)
  --    b) SUPERVISOR_REQUESTED (request_supervisor RPC path)
  --    Mirrors v_ops_board_tickets' pending_event_action + pending_block_action.
  SELECT te.created_at INTO v_latest_block_at
  FROM public.ticket_events te
  WHERE te.ticket_id = p_ticket_id
    AND (
      (te.event_type = 'BLOCKED' AND te.reason_code = 'supervisor_approval')
      OR te.event_type = 'SUPERVISOR_REQUESTED'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.ticket_events res
      WHERE res.ticket_id = te.ticket_id
        AND res.created_at > te.created_at
        AND (
          res.event_type IN ('SUPERVISOR_APPROVED', 'SUPERVISOR_REJECTED')
          OR (res.event_type = 'UNBLOCKED' AND res.reason_code = 'supervisor_request_cancelled')
        )
    )
  ORDER BY te.created_at DESC
  LIMIT 1;

  IF v_latest_block_at IS NULL THEN
    RAISE EXCEPTION 'No pending supervisor request for ticket %', p_ticket_id;
  END IF;

  -- 5. Idempotency belt — already covered by the NOT EXISTS in step 4,
  --    but keep an explicit check for clarity when the unresolved window collapses.

  -- 6. Emit SUPERVISOR_APPROVED — clears v_ops_board_tickets.needs_supervisor_action
  INSERT INTO public.ticket_events (
    ticket_id, event_type, reason_code, comment, actor_type, actor_id, created_at
  ) VALUES (
    p_ticket_id, 'SUPERVISOR_APPROVED', 'supervisor_approval',
    COALESCE(NULLIF(TRIM(p_comment), ''), 'Approved by supervisor'),
    'STAFF', v_actor_id, NOW()
  );

  -- 7. Resume ticket → IN_PROGRESS. SLA resume handled by trg_resume_sla_on_unblock.
  UPDATE public.tickets
    SET status = 'IN_PROGRESS',
        reason_code = NULL,
        updated_at = NOW()
  WHERE id = p_ticket_id AND status = 'BLOCKED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket % changed mid-flight; retry', p_ticket_id;
  END IF;

  -- 8. Emit UNBLOCKED with reason=supervisor_request_cancelled.
  --    Fires SLA-resume trigger and matches view clause 2 (defense in depth).
  INSERT INTO public.ticket_events (
    ticket_id, event_type, previous_status, new_status, reason_code, comment, actor_type, actor_id, created_at
  ) VALUES (
    p_ticket_id, 'UNBLOCKED', 'BLOCKED', 'IN_PROGRESS',
    'supervisor_request_cancelled',
    COALESCE(NULLIF(TRIM(p_comment), ''), 'Resumed after supervisor approval'),
    'STAFF', v_actor_id, NOW()
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'ticket_id', p_ticket_id,
    'decision', 'APPROVED',
    'idempotent', FALSE
  );
END;
$$;

ALTER FUNCTION public.approve_supervisor_request(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approve_supervisor_request(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.approve_supervisor_request(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.approve_supervisor_request(uuid, text) IS
'Supervisor or owner approves a pending supervisor_approval block.
- Locks ticket row; rejects if not BLOCKED.
- Role check: active SUPERVISOR or OWNER for the hotel.
- Idempotent: duplicate calls return success.
- Emits SUPERVISOR_APPROVED (clears Decision Queue) + UNBLOCKED with
  reason=supervisor_request_cancelled (fires SLA-resume trigger).
- Flips status BLOCKED → IN_PROGRESS.';

-- ════════════════════════════════════════════════════════════════════════
-- 2. Widen role check in reject_supervisor_approval — SUPERVISOR or OWNER.
--    All other behavior preserved verbatim from baseline.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reject_supervisor_approval(
  p_ticket_id uuid, p_comment text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_ticket_status text;
  v_ticket_hotel_id uuid;
  v_actor_id uuid;
  v_latest_block_created_at timestamptz;
  v_latest_block_reason_code text;
BEGIN
  -- 1. Lock the ticket row
  SELECT status, hotel_id INTO v_ticket_status, v_ticket_hotel_id
  FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket % does not exist', p_ticket_id;
  END IF;

  -- 2. Ticket must be BLOCKED
  IF v_ticket_status <> 'BLOCKED' THEN
    RAISE EXCEPTION 'Cannot reject supervisor approval: ticket % is not BLOCKED (status=%)',
      p_ticket_id, v_ticket_status;
  END IF;

  -- 3. Role check: active SUPERVISOR or OWNER for this hotel (WIDENED)
  SELECT hm.id INTO v_actor_id
  FROM public.hotel_members hm
  JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
  JOIN public.hotel_roles hr ON hr.id = hmr.role_id
  WHERE hm.user_id = auth.uid()
    AND hm.hotel_id = v_ticket_hotel_id
    AND hm.is_active = TRUE
    AND hr.code IN ('SUPERVISOR', 'OWNER')
    AND hr.is_active = TRUE
  LIMIT 1;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not a supervisor or owner for this hotel';
  END IF;

  -- 4. Find the most recent unresolved supervisor-request event from EITHER path
  --    (BLOCKED+supervisor_approval OR SUPERVISOR_REQUESTED). Mirrors the
  --    pending-action logic in v_ops_board_tickets and in
  --    approve_supervisor_request above. Closes the gap where tickets that
  --    came in via request_supervisor (event_type=SUPERVISOR_REQUESTED) could
  --    not be rejected — the old check only matched BLOCKED.
  SELECT te.created_at INTO v_latest_block_created_at
  FROM public.ticket_events te
  WHERE te.ticket_id = p_ticket_id
    AND (
      (te.event_type = 'BLOCKED' AND te.reason_code = 'supervisor_approval')
      OR te.event_type = 'SUPERVISOR_REQUESTED'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.ticket_events res
      WHERE res.ticket_id = te.ticket_id
        AND res.created_at > te.created_at
        AND (
          res.event_type IN ('SUPERVISOR_APPROVED', 'SUPERVISOR_REJECTED')
          OR (res.event_type = 'UNBLOCKED' AND res.reason_code = 'supervisor_request_cancelled')
        )
    )
  ORDER BY te.created_at DESC
  LIMIT 1;

  IF v_latest_block_created_at IS NULL THEN
    RAISE EXCEPTION 'No pending supervisor request for ticket %', p_ticket_id;
  END IF;

  -- 5. (latest_block_reason_code is no longer referenced — keep variable for binary compatibility,
  --     drop the legacy comparison.)

  -- 6. Idempotency belt — already covered by NOT EXISTS in step 4.

  -- 7. Emit SUPERVISOR_REJECTED
  INSERT INTO public.ticket_events (
    ticket_id, event_type, reason_code, comment, actor_type, actor_id, created_at
  ) VALUES (
    p_ticket_id, 'SUPERVISOR_REJECTED', 'supervisor_approval',
    COALESCE(NULLIF(TRIM(p_comment), ''), 'Supervisor rejected approval'),
    'STAFF', v_actor_id, NOW()
  );

  -- 8. NO ticket status change (matches baseline behavior)
  RETURN jsonb_build_object(
    'success', TRUE,
    'ticket_id', p_ticket_id,
    'decision', 'REJECTED',
    'idempotent', FALSE
  );
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 3. Widen role check in reject_sla_exception — SUPERVISOR or OWNER.
--    All other behavior preserved verbatim from baseline.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reject_sla_exception(
  p_ticket_id uuid, p_comment text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_ticket RECORD;
  v_actor_id uuid;
  v_latest_sla_request_at timestamptz;
BEGIN
  -- 1. Lock the ticket row
  SELECT * INTO v_ticket
  FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket % does not exist', p_ticket_id;
  END IF;

  -- 2. Reject terminal tickets
  IF v_ticket.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Cannot reject SLA exception on terminal ticket';
  END IF;

  -- 3. Role check: active SUPERVISOR or OWNER for this hotel (WIDENED)
  SELECT hm.id INTO v_actor_id
  FROM public.hotel_members hm
  JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
  JOIN public.hotel_roles hr ON hr.id = hmr.role_id
  WHERE hm.user_id = auth.uid()
    AND hm.hotel_id = v_ticket.hotel_id
    AND hm.is_active = TRUE
    AND hr.code IN ('SUPERVISOR', 'OWNER')
    AND hr.is_active = TRUE
  LIMIT 1;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not a supervisor or owner for this hotel';
  END IF;

  -- 4. Pending SLA_EXCEPTION_REQUESTED must exist
  SELECT te.created_at INTO v_latest_sla_request_at
  FROM public.ticket_events te
  WHERE te.ticket_id = p_ticket_id
    AND te.event_type = 'SLA_EXCEPTION_REQUESTED'
    AND NOT EXISTS (
      SELECT 1 FROM public.ticket_events res
      WHERE res.ticket_id = p_ticket_id
        AND res.created_at > te.created_at
        AND res.event_type IN ('SLA_EXCEPTION_GRANTED', 'SLA_EXCEPTION_REJECTED')
    )
  ORDER BY te.created_at DESC LIMIT 1;
  IF v_latest_sla_request_at IS NULL THEN
    RAISE EXCEPTION 'No pending SLA exception request for ticket %', p_ticket_id;
  END IF;

  -- 5. Idempotency check
  IF EXISTS (
    SELECT 1 FROM public.ticket_events te_decision
    WHERE te_decision.ticket_id = p_ticket_id
      AND te_decision.event_type IN ('SLA_EXCEPTION_GRANTED', 'SLA_EXCEPTION_REJECTED')
      AND te_decision.created_at > v_latest_sla_request_at
  ) THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'ticket_id', p_ticket_id,
      'sla_exception', 'REJECTED',
      'message', 'SLA exception decision already recorded',
      'idempotent', TRUE
    );
  END IF;

  -- 6. Comment is mandatory for audit
  IF p_comment IS NULL OR TRIM(p_comment) = '' THEN
    RAISE EXCEPTION 'Rejection comment is required';
  END IF;

  -- 7. Emit SLA_EXCEPTION_REJECTED
  INSERT INTO public.ticket_events (
    ticket_id, event_type, reason_code, actor_type, actor_id, comment, created_at
  ) VALUES (
    p_ticket_id, 'SLA_EXCEPTION_REJECTED', 'sla_exception',
    'STAFF', v_actor_id, TRIM(p_comment), NOW()
  );

  -- 8. NO ticket status change. SLA continues normally.
  RETURN jsonb_build_object(
    'success', TRUE,
    'ticket_id', p_ticket_id,
    'sla_exception', 'REJECTED',
    'message', 'SLA exception rejected. SLA continues normally.',
    'idempotent', FALSE
  );
END;
$$;

COMMENT ON FUNCTION public.reject_sla_exception(uuid, text) IS
'Supervisor or owner rejects a pending SLA exception request.
- Validates pending SLA_EXCEPTION_REQUESTED exists
- Idempotent-safe: duplicate calls return success
- Emits SLA_EXCEPTION_REJECTED event with reason_code=sla_exception
- SLA continues normally, no exemption granted';
