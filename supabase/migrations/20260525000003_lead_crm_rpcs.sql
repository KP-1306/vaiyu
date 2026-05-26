-- Lead CRM RPCs (Day 2)
--
-- 7 public RPCs + internal helpers. All RPCs:
--   - SECURITY DEFINER, search_path = public, auth (prevent search-path attacks)
--   - Explicit validation BEFORE insert (CHECK constraints stay as safety net)
--   - Write a lead_events row in the same transaction as state change
--   - Use vaiyu_is_hotel_member() / vaiyu_is_hotel_finance_manager() helpers
--   - Raise stable error codes (RAISE EXCEPTION 'CODE_NAME') — parseable by frontend
--
-- Public RPCs:
--   create_lead              — single-call constructor with phone normalize + dup warning
--   transition_lead_status   — enforces state-machine graph (the chokepoint)
--   assign_lead              — assign/unassign in one RPC (NULL = unassign)
--   soft_delete_lead         — manager+ only; clears claim; logs actor_role
--   update_lead_contact      — edit name/phone/email with diff event
--   update_lead_basics       — edit dates/party/value/tags with diff event
--   add_lead_note            — append note; updates latest_note_preview from event
--
-- Internal helpers (underscore prefix):
--   _normalize_phone(text)        — strip whitespace/dashes, prefix +91 for bare 10-digit
--   _hotel_role_code(uuid)        — returns caller's role code in this hotel (for event payloads)
--   _build_status_changed_payload, _build_contact_updated_payload — payload builders

-- ─── _normalize_phone ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._normalize_phone(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_phone IS NULL OR btrim(p_phone) = '' THEN NULL
    ELSE (
      WITH stripped AS (
        SELECT regexp_replace(p_phone, '[\s\-()]+', '', 'g') AS s
      )
      SELECT CASE
        WHEN s ~ '^\+\d{10,15}$' THEN s
        WHEN s ~ '^\d{10}$'      THEN '+91' || s
        WHEN s ~ '^91\d{10}$'    THEN '+' || s
        WHEN s ~ '^0\d{10}$'     THEN '+91' || substring(s from 2)
        ELSE s  -- unknown format — store as-stripped, dup-check may miss but no data loss
      END
      FROM stripped
    )
  END;
$$;

COMMENT ON FUNCTION public._normalize_phone IS
  'Normalize phone to E.164-ish form. India-aware default: bare 10-digit numbers get +91 prefix. International numbers (+xx...) preserved as-is. Used for duplicate detection on leads.';

-- ─── _hotel_role_code: caller's role in this hotel ────────────────────────

CREATE OR REPLACE FUNCTION public._hotel_role_code(p_hotel_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(
    (SELECT hr.code
       FROM public.hotel_members hm
       JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
       JOIN public.hotel_roles hr ON hr.id = hmr.role_id
      WHERE hm.user_id = auth.uid()
        AND hm.hotel_id = p_hotel_id
        AND hm.is_active = true
      LIMIT 1),
    (SELECT hm.role
       FROM public.hotel_members hm
      WHERE hm.user_id = auth.uid()
        AND hm.hotel_id = p_hotel_id
        AND hm.is_active = true
      LIMIT 1),
    'UNKNOWN'
  );
$$;

-- ─── create_lead ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_lead(
  p_hotel_id        uuid,
  p_source          public.lead_source,
  p_contact_name    text,
  p_source_detail   text DEFAULT NULL,
  p_contact_phone   text DEFAULT NULL,
  p_contact_email   text DEFAULT NULL,
  p_check_in        date DEFAULT NULL,
  p_check_out       date DEFAULT NULL,
  p_party_adults    integer DEFAULT 1,
  p_party_children  integer DEFAULT 0,
  p_room_count      integer DEFAULT 1,
  p_value_estimate  numeric DEFAULT NULL,
  p_notes           text DEFAULT NULL,
  p_tags            text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_lead_id    uuid;
  v_phone_norm text;
  v_actor_role text;
  v_dup_lead   record;
BEGIN
  -- Auth
  IF NOT public.vaiyu_is_hotel_member(p_hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Explicit validation (DB CHECK is safety net only)
  IF p_contact_name IS NULL OR btrim(p_contact_name) = '' THEN
    RAISE EXCEPTION 'INVALID_NAME';
  END IF;
  IF p_contact_phone IS NULL AND p_contact_email IS NULL THEN
    RAISE EXCEPTION 'INVALID_CONTACT';
  END IF;
  IF p_check_in IS NOT NULL AND p_check_out IS NOT NULL AND p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'INVALID_DATES';
  END IF;
  IF p_party_adults < 0 OR p_party_children < 0 OR p_room_count < 1 THEN
    RAISE EXCEPTION 'INVALID_PARTY';
  END IF;

  v_phone_norm := public._normalize_phone(p_contact_phone);
  v_actor_role := public._hotel_role_code(p_hotel_id);

  -- Insert
  INSERT INTO public.leads (
    hotel_id, source, source_detail,
    contact_name, contact_phone, contact_phone_normalized, contact_email,
    requested_check_in, requested_check_out,
    party_adults, party_children, room_count,
    value_estimate, latest_note_preview, tags
  ) VALUES (
    p_hotel_id, p_source, p_source_detail,
    btrim(p_contact_name), p_contact_phone, v_phone_norm, p_contact_email,
    p_check_in, p_check_out,
    p_party_adults, p_party_children, p_room_count,
    p_value_estimate, LEFT(p_notes, 200), COALESCE(p_tags, '{}')
  )
  RETURNING id INTO v_lead_id;

  -- Event: CREATED
  INSERT INTO public.lead_events (lead_id, hotel_id, event_type, payload, actor_id)
  VALUES (
    v_lead_id, p_hotel_id, 'CREATED',
    jsonb_build_object(
      'source', p_source::text,
      'source_detail', p_source_detail,
      'actor_role', v_actor_role,
      'has_phone', p_contact_phone IS NOT NULL,
      'has_email', p_contact_email IS NOT NULL
    ),
    auth.uid()
  );

  -- If we have an initial note, write NOTE_ADDED event too
  IF p_notes IS NOT NULL AND btrim(p_notes) <> '' THEN
    INSERT INTO public.lead_events (lead_id, hotel_id, event_type, payload, actor_id)
    VALUES (
      v_lead_id, p_hotel_id, 'NOTE_ADDED',
      jsonb_build_object('text', p_notes),
      auth.uid()
    );
  END IF;

  -- Duplicate detection: other lead in same hotel, same normalized phone, within 30 days
  IF v_phone_norm IS NOT NULL THEN
    SELECT id, status, created_at
      INTO v_dup_lead
      FROM public.leads
     WHERE hotel_id = p_hotel_id
       AND contact_phone_normalized = v_phone_norm
       AND id <> v_lead_id
       AND deleted_at IS NULL
       AND created_at > now() - interval '30 days'
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;

  IF v_dup_lead.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'lead_id', v_lead_id,
      'duplicate_warning', jsonb_build_object(
        'recent_lead_id', v_dup_lead.id,
        'recent_status', v_dup_lead.status,
        'days_ago', EXTRACT(day FROM now() - v_dup_lead.created_at)::int
      )
    );
  END IF;

  RETURN jsonb_build_object('lead_id', v_lead_id, 'duplicate_warning', NULL);
END;
$$;

-- ─── transition_lead_status ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.transition_lead_status(
  p_lead_id              uuid,
  p_to_status            public.lead_status,
  p_reason               text DEFAULT NULL,
  p_converted_booking_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_lead          record;
  v_allowed       boolean := false;
  v_booking_hotel uuid;
  v_extra_event   public.lead_event_type := NULL;
BEGIN
  -- Lock row + load current state
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF v_lead.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'LEAD_DELETED'; END IF;

  IF NOT public.vaiyu_is_hotel_member(v_lead.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Transition graph
  v_allowed := CASE
    WHEN v_lead.status = 'NEW'       AND p_to_status IN ('QUALIFIED','QUOTED','WON','LOST') THEN true
    WHEN v_lead.status = 'QUALIFIED' AND p_to_status IN ('QUOTED','WON','LOST')             THEN true
    WHEN v_lead.status = 'QUOTED'    AND p_to_status IN ('WON','LOST')                      THEN true
    WHEN v_lead.status = 'WON'       AND p_to_status IN ('CONVERTED','LOST')                THEN true
    WHEN v_lead.status = 'LOST'      AND p_to_status = 'NEW'                                THEN true
    ELSE false
  END;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: % -> %', v_lead.status, p_to_status;
  END IF;

  -- Per-transition validation
  IF p_to_status = 'LOST' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  IF p_to_status = 'CONVERTED' THEN
    IF p_converted_booking_id IS NULL THEN
      RAISE EXCEPTION 'BOOKING_REQUIRED';
    END IF;
    SELECT hotel_id INTO v_booking_hotel
      FROM public.bookings WHERE id = p_converted_booking_id;
    IF v_booking_hotel IS NULL THEN
      RAISE EXCEPTION 'BOOKING_NOT_FOUND';
    END IF;
    IF v_booking_hotel <> v_lead.hotel_id THEN
      RAISE EXCEPTION 'BOOKING_MISMATCH';
    END IF;
  END IF;

  -- Apply state change
  UPDATE public.leads SET
    status               = p_to_status,
    status_reason        = p_reason,
    won_at               = CASE WHEN p_to_status = 'WON' THEN COALESCE(won_at, now()) ELSE won_at END,
    converted_booking_id = CASE WHEN p_to_status = 'CONVERTED' THEN p_converted_booking_id ELSE converted_booking_id END,
    converted_at         = CASE WHEN p_to_status = 'CONVERTED' THEN now() ELSE converted_at END,
    last_activity_at     = now()
  WHERE id = p_lead_id;

  -- Primary event: STATUS_CHANGED
  INSERT INTO public.lead_events (lead_id, hotel_id, event_type, payload, actor_id)
  VALUES (
    p_lead_id, v_lead.hotel_id, 'STATUS_CHANGED',
    jsonb_build_object(
      'from', v_lead.status::text,
      'to',   p_to_status::text,
      'reason', p_reason,
      'converted_booking_id', p_converted_booking_id,
      'actor_role', public._hotel_role_code(v_lead.hotel_id)
    ),
    auth.uid()
  );

  -- Secondary event for REOPEN and CONVERT (timeline clarity)
  IF v_lead.status = 'LOST' AND p_to_status = 'NEW' THEN
    INSERT INTO public.lead_events (lead_id, hotel_id, event_type, payload, actor_id)
    VALUES (p_lead_id, v_lead.hotel_id, 'REOPENED',
            jsonb_build_object('previous_reason', v_lead.status_reason), auth.uid());
  END IF;

  IF p_to_status = 'CONVERTED' THEN
    INSERT INTO public.lead_events (lead_id, hotel_id, event_type, payload, actor_id)
    VALUES (p_lead_id, v_lead.hotel_id, 'CONVERTED_TO_BOOKING',
            jsonb_build_object(
              'booking_id', p_converted_booking_id,
              'actor_role', public._hotel_role_code(v_lead.hotel_id)
            ), auth.uid());
  END IF;
END;
$$;

-- ─── assign_lead ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.assign_lead(
  p_lead_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_lead     record;
  v_is_member boolean;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF v_lead.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'LEAD_DELETED'; END IF;

  IF NOT public.vaiyu_is_hotel_member(v_lead.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Verify target user is also a member of same hotel
  IF p_user_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.hotel_members hm
      WHERE hm.user_id = p_user_id
        AND hm.hotel_id = v_lead.hotel_id
        AND hm.is_active = true
    ) INTO v_is_member;
    IF NOT v_is_member THEN RAISE EXCEPTION 'ASSIGNEE_NOT_MEMBER'; END IF;
  END IF;

  -- No-op if unchanged
  IF v_lead.assigned_to IS NOT DISTINCT FROM p_user_id THEN
    RETURN;
  END IF;

  UPDATE public.leads
     SET assigned_to = p_user_id,
         last_activity_at = now()
   WHERE id = p_lead_id;

  IF p_user_id IS NULL THEN
    INSERT INTO public.lead_events (lead_id, hotel_id, event_type, payload, actor_id)
    VALUES (p_lead_id, v_lead.hotel_id, 'UNASSIGNED',
            jsonb_build_object('from_user', v_lead.assigned_to, 'by_user', auth.uid()),
            auth.uid());
  ELSE
    INSERT INTO public.lead_events (lead_id, hotel_id, event_type, payload, actor_id)
    VALUES (p_lead_id, v_lead.hotel_id, 'ASSIGNED',
            jsonb_build_object(
              'to_user', p_user_id,
              'prev_user', v_lead.assigned_to,
              'by_user', auth.uid()
            ),
            auth.uid());
  END IF;
END;
$$;

-- ─── soft_delete_lead ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.soft_delete_lead(
  p_lead_id uuid,
  p_reason  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_lead       record;
  v_actor_role text;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF v_lead.deleted_at IS NOT NULL THEN RETURN; END IF;  -- idempotent

  -- Manager/owner authority required (reuse finance-manager helper which covers
  -- OWNER, ADMIN, MANAGER, GENERAL_MANAGER, FINANCE_MANAGER — same authority band)
  IF NOT public.vaiyu_is_hotel_finance_manager(v_lead.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  v_actor_role := public._hotel_role_code(v_lead.hotel_id);

  UPDATE public.leads SET
    deleted_at       = now(),
    claimed_by       = NULL,
    claimed_at       = NULL,
    last_activity_at = now()
  WHERE id = p_lead_id;

  INSERT INTO public.lead_events (lead_id, hotel_id, event_type, payload, actor_id)
  VALUES (
    p_lead_id, v_lead.hotel_id, 'SOFT_DELETED',
    jsonb_build_object('reason', p_reason, 'actor_role', v_actor_role),
    auth.uid()
  );
END;
$$;

-- ─── update_lead_contact ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_lead_contact(
  p_lead_id uuid,
  p_name    text DEFAULT NULL,
  p_phone   text DEFAULT NULL,
  p_email   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_lead       record;
  v_new_name   text;
  v_new_phone  text;
  v_new_email  text;
  v_new_norm   text;
  v_changes    jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF v_lead.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'LEAD_DELETED'; END IF;

  IF NOT public.vaiyu_is_hotel_member(v_lead.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- NULL = no change. To clear a field, use a dedicated clear RPC (not in v1).
  v_new_name  := COALESCE(p_name,  v_lead.contact_name);
  v_new_phone := COALESCE(p_phone, v_lead.contact_phone);
  v_new_email := COALESCE(p_email, v_lead.contact_email);

  -- Re-validate contact_min
  IF v_new_phone IS NULL AND v_new_email IS NULL THEN
    RAISE EXCEPTION 'INVALID_CONTACT';
  END IF;
  IF btrim(v_new_name) = '' THEN
    RAISE EXCEPTION 'INVALID_NAME';
  END IF;

  v_new_norm := public._normalize_phone(v_new_phone);

  -- Build diff
  IF v_new_name IS DISTINCT FROM v_lead.contact_name THEN
    v_changes := v_changes || jsonb_build_object('name',
      jsonb_build_array(v_lead.contact_name, v_new_name));
  END IF;
  IF v_new_phone IS DISTINCT FROM v_lead.contact_phone THEN
    v_changes := v_changes || jsonb_build_object('phone',
      jsonb_build_array(v_lead.contact_phone, v_new_phone));
  END IF;
  IF v_new_norm IS DISTINCT FROM v_lead.contact_phone_normalized THEN
    v_changes := v_changes || jsonb_build_object('phone_normalized',
      jsonb_build_array(v_lead.contact_phone_normalized, v_new_norm));
  END IF;
  IF v_new_email IS DISTINCT FROM v_lead.contact_email THEN
    v_changes := v_changes || jsonb_build_object('email',
      jsonb_build_array(v_lead.contact_email, v_new_email));
  END IF;

  -- No-op if nothing changed
  IF v_changes = '{}'::jsonb THEN RETURN; END IF;

  UPDATE public.leads SET
    contact_name              = v_new_name,
    contact_phone             = v_new_phone,
    contact_phone_normalized  = v_new_norm,
    contact_email             = v_new_email,
    last_activity_at          = now()
  WHERE id = p_lead_id;

  INSERT INTO public.lead_events (lead_id, hotel_id, event_type, payload, actor_id)
  VALUES (
    p_lead_id, v_lead.hotel_id, 'CONTACT_UPDATED',
    jsonb_build_object('changes', v_changes),
    auth.uid()
  );
END;
$$;

-- ─── update_lead_basics ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_lead_basics(
  p_lead_id        uuid,
  p_check_in       date    DEFAULT NULL,
  p_check_out      date    DEFAULT NULL,
  p_party_adults   integer DEFAULT NULL,
  p_party_children integer DEFAULT NULL,
  p_room_count     integer DEFAULT NULL,
  p_value_estimate numeric DEFAULT NULL,
  p_source_detail  text    DEFAULT NULL,
  p_tags           text[]  DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_lead       record;
  v_new_in     date;
  v_new_out    date;
  v_new_pa     integer;
  v_new_pc     integer;
  v_new_rc     integer;
  v_new_val    numeric;
  v_new_detail text;
  v_new_tags   text[];
  v_changes    jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF v_lead.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'LEAD_DELETED'; END IF;

  IF NOT public.vaiyu_is_hotel_member(v_lead.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  v_new_in     := COALESCE(p_check_in,       v_lead.requested_check_in);
  v_new_out    := COALESCE(p_check_out,      v_lead.requested_check_out);
  v_new_pa     := COALESCE(p_party_adults,   v_lead.party_adults);
  v_new_pc     := COALESCE(p_party_children, v_lead.party_children);
  v_new_rc     := COALESCE(p_room_count,     v_lead.room_count);
  v_new_val    := COALESCE(p_value_estimate, v_lead.value_estimate);
  v_new_detail := COALESCE(p_source_detail,  v_lead.source_detail);
  v_new_tags   := COALESCE(p_tags,           v_lead.tags);

  -- Validate
  IF v_new_in IS NOT NULL AND v_new_out IS NOT NULL AND v_new_out <= v_new_in THEN
    RAISE EXCEPTION 'INVALID_DATES';
  END IF;
  IF v_new_pa < 0 OR v_new_pc < 0 OR v_new_rc < 1 THEN
    RAISE EXCEPTION 'INVALID_PARTY';
  END IF;

  IF v_new_in IS DISTINCT FROM v_lead.requested_check_in THEN
    v_changes := v_changes || jsonb_build_object('check_in', jsonb_build_array(v_lead.requested_check_in, v_new_in));
  END IF;
  IF v_new_out IS DISTINCT FROM v_lead.requested_check_out THEN
    v_changes := v_changes || jsonb_build_object('check_out', jsonb_build_array(v_lead.requested_check_out, v_new_out));
  END IF;
  IF v_new_pa IS DISTINCT FROM v_lead.party_adults THEN
    v_changes := v_changes || jsonb_build_object('party_adults', jsonb_build_array(v_lead.party_adults, v_new_pa));
  END IF;
  IF v_new_pc IS DISTINCT FROM v_lead.party_children THEN
    v_changes := v_changes || jsonb_build_object('party_children', jsonb_build_array(v_lead.party_children, v_new_pc));
  END IF;
  IF v_new_rc IS DISTINCT FROM v_lead.room_count THEN
    v_changes := v_changes || jsonb_build_object('room_count', jsonb_build_array(v_lead.room_count, v_new_rc));
  END IF;
  IF v_new_val IS DISTINCT FROM v_lead.value_estimate THEN
    v_changes := v_changes || jsonb_build_object('value_estimate', jsonb_build_array(v_lead.value_estimate, v_new_val));
  END IF;
  IF v_new_detail IS DISTINCT FROM v_lead.source_detail THEN
    v_changes := v_changes || jsonb_build_object('source_detail', jsonb_build_array(v_lead.source_detail, v_new_detail));
  END IF;
  IF v_new_tags IS DISTINCT FROM v_lead.tags THEN
    v_changes := v_changes || jsonb_build_object('tags', jsonb_build_array(to_jsonb(v_lead.tags), to_jsonb(v_new_tags)));
  END IF;

  IF v_changes = '{}'::jsonb THEN RETURN; END IF;

  UPDATE public.leads SET
    requested_check_in  = v_new_in,
    requested_check_out = v_new_out,
    party_adults        = v_new_pa,
    party_children      = v_new_pc,
    room_count          = v_new_rc,
    value_estimate      = v_new_val,
    source_detail       = v_new_detail,
    tags                = v_new_tags,
    last_activity_at    = now()
  WHERE id = p_lead_id;

  INSERT INTO public.lead_events (lead_id, hotel_id, event_type, payload, actor_id)
  VALUES (
    p_lead_id, v_lead.hotel_id, 'BASICS_UPDATED',
    jsonb_build_object('changes', v_changes),
    auth.uid()
  );
END;
$$;

-- ─── add_lead_note ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.add_lead_note(
  p_lead_id uuid,
  p_text    text
)
RETURNS uuid  -- returns event id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_lead     record;
  v_event_id uuid;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF v_lead.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'LEAD_DELETED'; END IF;

  IF NOT public.vaiyu_is_hotel_member(v_lead.hotel_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_text IS NULL OR btrim(p_text) = '' THEN
    RAISE EXCEPTION 'NOTE_EMPTY';
  END IF;

  UPDATE public.leads
     SET latest_note_preview = LEFT(btrim(p_text), 200),
         last_activity_at    = now()
   WHERE id = p_lead_id;

  INSERT INTO public.lead_events (lead_id, hotel_id, event_type, payload, actor_id)
  VALUES (p_lead_id, v_lead.hotel_id, 'NOTE_ADDED',
          jsonb_build_object('text', p_text),
          auth.uid())
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

-- ─── Grants ──────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.create_lead              TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_lead_status   TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_lead              TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_lead         TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_lead_contact      TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_lead_basics       TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_lead_note            TO authenticated;

-- Internal helpers are not granted to authenticated — RPC-internal only.
