-- Kitchen-owned revised ETA for food orders.
--
-- Problem (raised 2026-06-11): the guest-facing FoodOrderTracker showed the
-- ORIGINAL SLA target time even when the order was breached by hours. A
-- guest looking at the screen saw "Estimated arrival 21:56" with "123 MIN
-- LATE" — a time already two hours in the past, presented as the arrival
-- time. Standard practice across Swiggy / Zomato / DoorDash / Amazon is to
-- give the guest a fresh, committed time when something slips. "ASAP" is
-- explicitly an anti-pattern — it gives the guest no number to plan around.
--
-- Fix:
--   1. Add four columns to food_order_sla_state, all NULLABLE so existing
--      rows are unaffected and the existing flow continues to work:
--        sla_revised_target_at   — kitchen's fresh committed ETA
--        sla_revised_at          — when the revision was made
--        sla_revised_by          — hotel_member who made it (audit trail)
--        sla_revision_count      — how many times kitchen has pushed it
--                                  (so a hotel that revises 5x looks bad)
--
--   2. New RPC update_food_order_eta(p_order_id, p_hotel_id, p_new_target_at,
--      p_comment). Locked down with the same role gate every other kitchen
--      RPC uses (KITCHEN, KITCHEN_MANAGER, ADMIN, OWNER, MANAGER — added
--      MANAGER for ops cover). Hardens against three classes of bad data:
--        - new target must be strictly in the future (can't backdate)
--        - new target must be strictly later than current target (can't
--          pull it forward to game the SLA)
--        - order must be in an in-flight status (rejects CANCELLED /
--          COMPLETED / DELIVERED / CLOSED)
--      Emits a 'SLA_ETA_REVISED' event to food_order_events for the
--      existing timeline UI to display.
--
--   3. Re-grant SELECT on food_order_sla_state so the new columns become
--      visible to the guest tracker (the table already had the policy
--      "Public view food sla" granting SELECT to anon, authenticated).
--
-- Backwards compatible by construction: every existing query against
-- food_order_sla_state continues to work; sla_revised_target_at = NULL on
-- every existing row means the frontend falls back to sla_target_at.

BEGIN;

-- ─── 1. Additive columns ────────────────────────────────────────────────
ALTER TABLE public.food_order_sla_state
  ADD COLUMN IF NOT EXISTS sla_revised_target_at timestamp without time zone,
  ADD COLUMN IF NOT EXISTS sla_revised_at        timestamp without time zone,
  ADD COLUMN IF NOT EXISTS sla_revised_by        uuid REFERENCES public.hotel_members(id),
  ADD COLUMN IF NOT EXISTS sla_revision_count    integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.food_order_sla_state.sla_revised_target_at IS
  'Fresh kitchen-committed ETA when the order is running behind. NULL means no revision; UI falls back to sla_target_at.';
COMMENT ON COLUMN public.food_order_sla_state.sla_revision_count IS
  'Number of times the kitchen has pushed the ETA. Used for SLA quality reports.';

-- ─── 1b. Extend food_order_events.event_type CHECK to allow the new
--          'SLA_ETA_REVISED' audit event the RPC below emits. Drop + recreate
--          the constraint with the full original list plus the new value.
ALTER TABLE public.food_order_events
  DROP CONSTRAINT IF EXISTS food_order_events_event_type_check;

ALTER TABLE public.food_order_events
  ADD CONSTRAINT food_order_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'ORDER_CREATED', 'ORDER_ACCEPTED', 'ORDER_PREPARING', 'ORDER_READY',
    'ORDER_DELIVERED', 'ORDER_CANCELLED',
    'ITEM_ADDED', 'ITEM_STARTED', 'ITEM_READY', 'ITEM_CANCELLED',
    'ORDER_DELAYED', 'ORDER_FAILED',
    'KITCHEN_ASSIGNED', 'RUNNER_ASSIGNED',
    'COMMENT_ADDED',
    'SLA_ETA_REVISED'   -- new: emitted by update_food_order_eta
  ]));

-- ─── 2. update_food_order_eta RPC ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_food_order_eta(
  p_order_id       uuid,
  p_hotel_id       uuid,
  p_new_target_at  timestamp without time zone,
  p_comment        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_actor_id     uuid;
  v_status       text;
  v_current_target timestamp without time zone;
  v_new_count    integer;
BEGIN
  -- 1. Role gate — same kitchen-class roles every other food RPC uses,
  --    plus MANAGER for ops cover.
  SELECT hm.id INTO v_actor_id
  FROM public.hotel_members hm
  JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
  JOIN public.hotel_roles hr ON hr.id = hmr.role_id
  WHERE hm.user_id = auth.uid()
    AND hm.hotel_id = p_hotel_id
    AND hm.is_active = TRUE
    AND hr.code IN ('KITCHEN', 'KITCHEN_MANAGER', 'KITCHEN_STAFF', 'ADMIN', 'OWNER', 'MANAGER')
    AND hr.is_active = TRUE
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not authorised to update food order ETA for this hotel';
  END IF;

  -- 2. Lock the order row and verify it belongs to the hotel + is in-flight.
  SELECT status INTO v_status
  FROM public.food_orders
  WHERE id = p_order_id
    AND hotel_id = p_hotel_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Food order % does not exist for hotel %', p_order_id, p_hotel_id;
  END IF;

  IF v_status IN ('CANCELLED', 'DELIVERED', 'COMPLETED', 'CLOSED') THEN
    RAISE EXCEPTION 'Cannot revise ETA on terminal order (status=%)', v_status;
  END IF;

  -- 3. Validate new target — must be in the future, must be later than the
  --    current target (kitchen can only push back, never pull in).
  IF p_new_target_at IS NULL OR p_new_target_at <= now() AT TIME ZONE 'UTC' THEN
    RAISE EXCEPTION 'New ETA must be a time strictly in the future';
  END IF;

  -- Current target = revised if set else original. SLA row may not exist yet
  -- if the kitchen hasn't accepted; we create one lazily.
  SELECT COALESCE(sla_revised_target_at, sla_target_at) INTO v_current_target
  FROM public.food_order_sla_state
  WHERE food_order_id = p_order_id;

  IF v_current_target IS NOT NULL AND p_new_target_at <= v_current_target THEN
    RAISE EXCEPTION 'New ETA must be later than the current target (current=%, new=%)',
      v_current_target, p_new_target_at;
  END IF;

  -- 4. Upsert SLA state with the new revised target + bumped count.
  INSERT INTO public.food_order_sla_state (
    food_order_id, sla_started_at, sla_target_at,
    sla_revised_target_at, sla_revised_at, sla_revised_by, sla_revision_count
  )
  VALUES (
    p_order_id, now(), p_new_target_at,
    p_new_target_at, now(), v_actor_id, 1
  )
  ON CONFLICT (food_order_id) DO UPDATE
    SET sla_revised_target_at = EXCLUDED.sla_revised_target_at,
        sla_revised_at        = EXCLUDED.sla_revised_at,
        sla_revised_by        = EXCLUDED.sla_revised_by,
        sla_revision_count    = food_order_sla_state.sla_revision_count + 1,
        updated_at            = now()
  RETURNING sla_revision_count INTO v_new_count;

  -- 5. Audit event for the tracker timeline.
  INSERT INTO public.food_order_events (id, food_order_id, event_type, actor_type, actor_id, payload, created_at)
  VALUES (
    gen_random_uuid(),
    p_order_id,
    'SLA_ETA_REVISED',
    'KITCHEN',
    auth.uid(),
    jsonb_build_object(
      'new_target_at', p_new_target_at,
      'comment',       COALESCE(NULLIF(TRIM(p_comment), ''), null),
      'revision_count', v_new_count
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'order_id', p_order_id,
    'new_target_at', p_new_target_at,
    'revision_count', v_new_count
  );
END;
$$;

ALTER FUNCTION public.update_food_order_eta(uuid, uuid, timestamp without time zone, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_food_order_eta(uuid, uuid, timestamp without time zone, text) FROM public;
GRANT EXECUTE ON FUNCTION public.update_food_order_eta(uuid, uuid, timestamp without time zone, text) TO authenticated;

COMMENT ON FUNCTION public.update_food_order_eta(uuid, uuid, timestamp without time zone, text) IS
'Kitchen / manager / owner pushes a fresh ETA for an in-flight food order.
- Role-gated to KITCHEN, KITCHEN_MANAGER, KITCHEN_STAFF, ADMIN, OWNER, MANAGER.
- Rejects backdated targets and pull-in attempts.
- Rejects revisions on terminal orders (CANCELLED/DELIVERED/COMPLETED/CLOSED).
- Bumps sla_revision_count and emits SLA_ETA_REVISED event for the timeline.';

COMMIT;
