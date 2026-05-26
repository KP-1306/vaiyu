-- Lead conversion RPC (Day 4) — convert_lead_to_walkin
--
-- Atomic bridge between leads and bookings. One RPC call:
--   1. Locks the lead (FOR UPDATE) and validates state
--   2. Auto-promotes through intermediate statuses (NEW→QUALIFIED→QUOTED→WON)
--      if the lead is being converted from earlier in the pipeline
--   3. Calls create_walkin_v2 to create the booking + check-in atomically
--   4. Sets bookings.lead_id back-link
--   5. Marks lead CONVERTED, clears any active claim
--   6. Writes CONVERTED_TO_BOOKING and (optionally) CLAIM_RELEASED events
--
-- Whole thing in a single DB transaction. If create_walkin_v2 fails for any
-- reason (room conflict, validation error, etc.) the entire conversion rolls
-- back including promotion events. Lead state is preserved exactly as it was
-- pre-conversion.
--
-- Codebase verification done before writing (per CLAUDE.md):
--   - create_walkin_v2 is pure plpgsql, inherits outer transaction, never COMMITs
--     internally. Its EXCEPTION block re-raises with WHEN OTHERS THEN RAISE.
--     Atomicity assumption holds.
--   - create_reservation (or equivalent for future bookings) does NOT exist in
--     this codebase. Day 4.5 (convert_lead_to_reservation) is therefore deferred
--     until that infrastructure is built. Trigger to revisit: when a hotel
--     requests future-reservation conversion OR when a generic create_reservation
--     RPC lands for other reasons.
--
-- Timestamp choice (per CLAUDE.md):
--   - Event payload timestamps use clock_timestamp() throughout for microsecond
--     ordering, consistent with lead_events.occurred_at default.
--   - Latency computation uses clock_timestamp() at start and end of RPC for
--     a real wall-clock measurement (not transaction-scoped).
--
-- Reviewer-driven design choices baked in:
--   - _validate_walkin_args() helper (will be reused by future conversion RPCs)
--   - conversion_started_from field in every auto-promoted STATUS_CHANGED event
--   - conversion_latency_ms in CONVERTED_TO_BOOKING payload for telemetry
--
-- Stylistic deferrals (user-approved with explicit triggers, not "not urgent"):
--   - release_type stays as text (not formal PG enum) — values are single-source
--     written by RPCs, type-safety from enum is marginal. Trigger: convert to
--     enum when >5 release_type values exist OR when analytics consumes them.
--   - bookings.lead_id update inline (not extracted to helper) — single callsite,
--     extracting now is premature abstraction (rule of three). Trigger: extract
--     when a second RPC needs the same UPDATE pattern.

-- ─── _validate_walkin_args ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._validate_walkin_args(p_args jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_args IS NULL OR p_args = '{}'::jsonb THEN
    RAISE EXCEPTION 'WALKIN_ARGS_REQUIRED';
  END IF;

  IF NOT (p_args ? 'guest_details'
          AND p_args ? 'room_selections'
          AND p_args ? 'checkin_date'
          AND p_args ? 'checkout_date') THEN
    RAISE EXCEPTION 'WALKIN_ARGS_INCOMPLETE'
      USING DETAIL = 'Required keys: guest_details, room_selections, checkin_date, checkout_date';
  END IF;

  IF jsonb_typeof(p_args->'guest_details') <> 'object' THEN
    RAISE EXCEPTION 'GUEST_DETAILS_MUST_BE_OBJECT';
  END IF;

  IF COALESCE(btrim(p_args->'guest_details'->>'full_name'), '') = '' THEN
    RAISE EXCEPTION 'GUEST_NAME_REQUIRED';
  END IF;

  IF jsonb_typeof(p_args->'room_selections') <> 'array' THEN
    RAISE EXCEPTION 'ROOM_SELECTIONS_MUST_BE_ARRAY';
  END IF;

  IF jsonb_array_length(p_args->'room_selections') = 0 THEN
    RAISE EXCEPTION 'ROOM_SELECTIONS_EMPTY';
  END IF;

  -- Date validity (string format check; full parse happens in main RPC cast)
  IF (p_args->>'checkin_date') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'INVALID_CHECKIN_DATE_FORMAT';
  END IF;
  IF (p_args->>'checkout_date') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'INVALID_CHECKOUT_DATE_FORMAT';
  END IF;
END;
$$;

COMMENT ON FUNCTION public._validate_walkin_args IS
  'Shape validation for walkin_args jsonb. Single source of truth — reused by convert_lead_to_walkin and any future conversion RPC (reservation, OTA, kiosk, WhatsApp). Raises stable error codes; frontend contracts are deterministic.';

-- ─── convert_lead_to_walkin ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.convert_lead_to_walkin(
  p_lead_id     uuid,
  p_walkin_args jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_lead            record;
  v_existing_code   text;
  v_from_status     lead_status;
  v_prev_status     lead_status;
  v_promotion_path  lead_status[];
  v_stage           lead_status;
  v_walkin_result   jsonb;
  v_booking_id      uuid;
  v_booking_code    text;
  v_booking_hotel   uuid;
  v_actor_role      text;
  v_start_ts        timestamptz;
  v_latency_ms      integer;
BEGIN
  -- Capture start for latency telemetry
  v_start_ts := clock_timestamp();

  -- Lock + load lead
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF v_lead.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'LEAD_DELETED'; END IF;

  IF NOT public.vaiyu_is_hotel_member(v_lead.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Idempotency: structured error with both id and code for clean frontend parsing
  IF v_lead.status = 'CONVERTED' THEN
    SELECT code INTO v_existing_code
      FROM public.bookings WHERE id = v_lead.converted_booking_id;
    RAISE EXCEPTION 'ALREADY_CONVERTED'
      USING DETAIL = jsonb_build_object(
        'existing_booking_id',   v_lead.converted_booking_id,
        'existing_booking_code', v_existing_code
      )::text,
      HINT = 'Navigate to existing booking instead of re-converting';
  END IF;

  IF v_lead.status = 'LOST' THEN
    RAISE EXCEPTION 'LEAD_IS_LOST'
      USING HINT = 'Reopen via transition_lead_status(LOST → NEW) before converting';
  END IF;

  -- Validate walkin args via shared helper (BEFORE any state mutation)
  PERFORM public._validate_walkin_args(p_walkin_args);

  v_from_status := v_lead.status;
  v_actor_role  := public._hotel_role_code(v_lead.hotel_id);

  -- Determine promotion path: which stages to traverse to reach CONVERTED
  v_promotion_path := CASE v_from_status
    WHEN 'NEW'       THEN ARRAY['QUALIFIED','QUOTED','WON']::lead_status[]
    WHEN 'QUALIFIED' THEN ARRAY['QUOTED','WON']::lead_status[]
    WHEN 'QUOTED'    THEN ARRAY['WON']::lead_status[]
    WHEN 'WON'       THEN ARRAY[]::lead_status[]
  END;

  -- Auto-promote through intermediate stages (no-op if from WON)
  v_prev_status := v_from_status;
  FOREACH v_stage IN ARRAY v_promotion_path
  LOOP
    UPDATE public.leads
       SET status            = v_stage,
           won_at            = CASE WHEN v_stage = 'WON' THEN COALESCE(won_at, clock_timestamp()) ELSE won_at END,
           last_activity_at  = clock_timestamp()
     WHERE id = p_lead_id;

    INSERT INTO public.lead_events (lead_id, hotel_id, event_type, payload, actor_id)
    VALUES (
      p_lead_id, v_lead.hotel_id, 'STATUS_CHANGED',
      jsonb_build_object(
        'from',                    v_prev_status::text,
        'to',                      v_stage::text,
        'reason',                  'convert_to_walkin',
        'converted_booking_id',    NULL,
        'actor_role',              v_actor_role,
        'auto_promoted',           true,
        'transition_mode',         'auto_convert',
        'conversion_started_from', v_from_status::text
      ),
      auth.uid()
    );

    v_prev_status := v_stage;
  END LOOP;

  -- Call create_walkin_v2. Any exception (room conflict, validation, etc.)
  -- propagates through and rolls back all promotion events above + the lead
  -- UPDATEs. The lead returns to v_from_status as if nothing happened.
  v_walkin_result := public.create_walkin_v2(
    p_hotel_id        => v_lead.hotel_id,
    p_guest_details   => p_walkin_args->'guest_details',
    p_room_selections => p_walkin_args->'room_selections',
    p_checkin_date    => (p_walkin_args->>'checkin_date')::date,
    p_checkout_date   => (p_walkin_args->>'checkout_date')::date,
    p_adults          => COALESCE((p_walkin_args->>'adults')::integer,   v_lead.party_adults),
    p_children        => COALESCE((p_walkin_args->>'children')::integer, v_lead.party_children),
    p_actor_id        => auth.uid()
  );

  v_booking_id   := (v_walkin_result->>'booking_id')::uuid;
  v_booking_code := v_walkin_result->>'booking_code';

  IF v_booking_id IS NULL THEN
    RAISE EXCEPTION 'BOOKING_CREATION_FAILED'
      USING DETAIL = 'create_walkin_v2 returned no booking_id: ' || v_walkin_result::text;
  END IF;

  -- Defensive: verify booking belongs to same hotel
  SELECT hotel_id INTO v_booking_hotel FROM public.bookings WHERE id = v_booking_id;
  IF v_booking_hotel IS DISTINCT FROM v_lead.hotel_id THEN
    RAISE EXCEPTION 'BOOKING_HOTEL_MISMATCH';
  END IF;

  -- Final lead state + claim release in one UPDATE
  UPDATE public.leads SET
    status               = 'CONVERTED',
    converted_booking_id = v_booking_id,
    converted_at         = clock_timestamp(),
    won_at               = COALESCE(won_at, clock_timestamp()),
    claimed_by           = NULL,
    claimed_at           = NULL,
    last_activity_at     = clock_timestamp()
  WHERE id = p_lead_id;

  -- Booking ↔ lead back-link
  UPDATE public.bookings SET lead_id = p_lead_id WHERE id = v_booking_id;

  -- Telemetry: how long did the whole conversion take?
  v_latency_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_start_ts)) * 1000)::integer;

  -- CONVERTED_TO_BOOKING event
  INSERT INTO public.lead_events (lead_id, hotel_id, event_type, payload, actor_id)
  VALUES (
    p_lead_id, v_lead.hotel_id, 'CONVERTED_TO_BOOKING',
    jsonb_build_object(
      'booking_id',            v_booking_id,
      'booking_code',          v_booking_code,
      'from_status',           v_from_status::text,
      'promoted_through',      to_jsonb(v_promotion_path),
      'by_user',               auth.uid(),
      'by_user_name',          public._user_display_name(auth.uid()),
      'actor_role',            v_actor_role,
      'conversion_origin',     'walkin',
      'conversion_latency_ms', v_latency_ms
    ),
    auth.uid()
  );

  -- CLAIM_RELEASED event ONLY if a claim was actually held pre-conversion
  IF v_lead.claimed_by IS NOT NULL THEN
    INSERT INTO public.lead_events (lead_id, hotel_id, event_type, payload, actor_id)
    VALUES (
      p_lead_id, v_lead.hotel_id, 'CLAIM_RELEASED',
      jsonb_build_object(
        'by_user',           auth.uid(),
        'by_user_name',      public._user_display_name(auth.uid()),
        'prev_holder',       v_lead.claimed_by,
        'prev_holder_name',  public._user_display_name(v_lead.claimed_by),
        'release_type',      'auto_on_convert',
        'reason',            'Lead converted to booking ' || v_booking_code,
        'actor_role',        v_actor_role
      ),
      auth.uid()
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',                    true,
    'booking_id',            v_booking_id,
    'booking_code',          v_booking_code,
    'from_status',           v_from_status::text,
    'promoted_through',      to_jsonb(v_promotion_path),
    'conversion_latency_ms', v_latency_ms
  );
END;
$$;

-- ─── Grants ──────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.convert_lead_to_walkin TO authenticated;
-- _validate_walkin_args is internal — no grant.
