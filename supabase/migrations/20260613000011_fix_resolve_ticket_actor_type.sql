-- Fix resolve_ticket: it crashes on every call, and (once that's fixed) leaves
-- tickets in an inconsistent state under RLS.
--
-- ROOT CAUSE 1 (reproduced on local; identical baseline definition on prod):
--   resolve_ticket inserts into ticket_events without actor_type, but
--   ticket_events.actor_type is NOT NULL (no default, no fill-trigger) → every
--   call raises a not-null violation. This RPC backs the Desk SLA board's
--   "Resolve"/"Close" actions (web rpc + supabase/functions/tickets), so those
--   buttons fail in production. complete_task (Staff Task Manager) is unaffected.
--
-- ROOT CAUSE 2 (found by hostile testing the actor_type-only fix):
--   resolve_ticket was SECURITY INVOKER. The tickets-UPDATE RLS does not let an
--   arbitrary hotel member flip status, but the ticket_events INSERT policy
--   (any hotel member) does — so an INVOKER fix would write a COMPLETED event
--   while the ticket stays NEW. Inconsistent.
--
-- FIX: mirror complete_task — SECURITY DEFINER with an explicit membership
--   authorization check (replacing RLS), so the status UPDATE and the event
--   INSERT both apply atomically. Actor is the caller's hotel_members.id,
--   recorded as actor_type='STAFF' (satisfies chk_actor_id_required_for_staff).
--   Unlike complete_task, no assignee requirement and any active status may be
--   resolved (the Desk board is a supervisor surface). Refuses already-terminal
--   tickets and locks the row FOR UPDATE. anon EXECUTE is revoked (it was a
--   harmless leftover under INVOKER+RLS; under DEFINER it must not be callable
--   by anon — the auth check also blocks it).
--
-- close_ticket (which PERFORMs resolve_ticket) inherits the fix unchanged.

CREATE OR REPLACE FUNCTION public.resolve_ticket(p_ticket_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id     uuid;
  v_hotel_id    uuid;
  v_prev_status text;
  v_member_id   uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT hotel_id, status INTO v_hotel_id, v_prev_status
  FROM tickets WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  -- Authorize: DEFINER bypasses RLS, so require an active membership explicitly.
  SELECT id INTO v_member_id
  FROM hotel_members
  WHERE user_id = v_user_id AND hotel_id = v_hotel_id AND is_active = true;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not an active staff member of this hotel';
  END IF;

  IF v_prev_status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Ticket is already % and cannot be resolved', v_prev_status;
  END IF;

  UPDATE tickets
  SET status = 'COMPLETED',
      completed_at = now()
  WHERE id = p_ticket_id;

  INSERT INTO ticket_events (ticket_id, event_type, previous_status, new_status, actor_type, actor_id)
  VALUES (p_ticket_id, 'COMPLETED', v_prev_status, 'COMPLETED', 'STAFF', v_member_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_ticket(uuid) FROM anon;

COMMENT ON FUNCTION public.resolve_ticket(uuid) IS
  'Resolve a ticket to COMPLETED from the Desk board. SECURITY DEFINER with an explicit active-membership check (any member of the ticket''s hotel; no assignee requirement). Records a ticket_events COMPLETED event attributed to the caller (actor_type STAFF, actor_id = hotel_members.id), captures previous_status, locks the row, and refuses already-terminal tickets.';
