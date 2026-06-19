-- ============================================================
-- VAiyu: fix wa_resolve_hotel_for_phone (inbound WhatsApp routing)
-- ============================================================
-- This function answers "whose guest is this, and at which hotel?" for an
-- inbound WhatsApp message, keyed only on the sender's phone. It is the first
-- decision in interakt-webhook routing: 0 matches -> drop as unknown_guest,
-- 1 -> record into that hotel's chat thread, many -> ask which property.
--
-- Discovered during the read-path PII sweep (20260619000010) that it was DEAD
-- ON ARRIVAL against the real schema. FOUR independent defects, each of which
-- alone makes it return nothing / error (the edge fn swallows errors to []),
-- so EVERY inbound message would be dropped as unknown_guest once WhatsApp
-- inbound goes live:
--
--   1. Columns don't exist: body used b.check_in_at / b.check_out_at; bookings
--      has checked_in_at, scheduled_checkin_at, scheduled_checkout_at. The first
--      RETURN QUERY raised "column b.check_in_at does not exist".
--   2. Status casing/values: filtered IN ('checked_in','confirmed','tentative');
--      prod stores UPPERCASE CHECKED_IN / CONFIRMED / PRE_CHECKED_IN (no
--      'tentative'). Matches zero rows.
--   3. Wrong guest column: matched _normalize_phone(g.phone), but guests.phone
--      is populated for 0 rows — the number lives in guests.mobile_normalized.
--   4. Normalization scheme mismatch (the subtle one): guests.mobile_normalized
--      is NATIONAL 10-digit (e.g. '8899776644'; populated by submit_precheckin's
--      regexp_replace(phone,'[^0-9]','')), whereas _normalize_phone returns
--      E.164 ('+918899776644'). So g.mobile_normalized = _normalize_phone(...)
--      can NEVER match. Inbound WhatsApp numbers from Interakt carry the country
--      code. leads.contact_phone_normalized, by contrast, IS E.164 (written via
--      _normalize_phone in create_lead_public) — so leads must be matched in
--      E.164 space, guests in national-digit space. (Verified on prod: 14/14
--      guests 10-digit / 0 E.164; leads prefixed '+'.)
--
-- FIX (every referenced column verified to exist + be populated + indexed on
-- prod; matching mirrors the submit_precheckin guest-lookup precedent):
--   * Guests: build national-digit candidates from the inbound number and match
--     g.mobile_normalized via an IN-list of equality constants (sargable on
--     idx_guests_mobile_normalized) — covers the number stored as national
--     10-digit, as 91+national, or as raw inbound digits, regardless of whether
--     either side carries the +91. India market (CLAUDE.md); national form is
--     the right(...,10).
--   * Leads: match l.contact_phone_normalized = E.164 (covered by
--     idx_leads_dupcheck (hotel_id, contact_phone_normalized) WHERE deleted_at
--     IS NULL — matches block 3's own filter; handles non-India leads too).
--   * Date window keys off scheduled_checkin_at (forward-looking "arriving
--     within 7 days"; a not-yet-arrived CONFIRMED guest has a future
--     scheduled_checkin_at but NULL checked_in_at). Departure uses
--     scheduled_checkout_at. status set = ('CHECKED_IN','CONFIRMED',
--     'PRE_CHECKED_IN'). matched_at returns scheduled_checkin_at / created_at.
--
-- Grant stays service_role-only (set in 20260619000010 — interakt-webhook is the
-- sole caller, via SERVICE_ROLE_KEY). CREATE OR REPLACE preserves ACLs;
-- re-asserted below to keep this migration self-contained.
-- ============================================================

CREATE OR REPLACE FUNCTION public.wa_resolve_hotel_for_phone(p_phone text)
 RETURNS TABLE(hotel_id uuid, hotel_slug text, hotel_name text, booking_id uuid, matched_at timestamp with time zone, match_kind text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_in_digits text := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  v_nat10     text := NULLIF(right(v_in_digits, 10), '');
  v_e164      text := public._normalize_phone(p_phone);
BEGIN
  -- Need at least a usable national number to match a guest.
  IF v_nat10 IS NULL THEN
    RETURN;
  END IF;

  -- Prefer: an active booking (currently staying or arriving within 7 days)
  RETURN QUERY
  SELECT
    h.id, h.slug, h.name, b.id, b.scheduled_checkin_at, 'ACTIVE_BOOKING'::text
  FROM public.bookings b
  JOIN public.hotels h ON h.id = b.hotel_id
  JOIN public.guests g ON g.id = b.guest_id
  WHERE g.mobile_normalized IN (v_nat10, '91' || v_nat10, v_in_digits)
    AND b.status IN ('CHECKED_IN', 'CONFIRMED', 'PRE_CHECKED_IN')
    AND b.scheduled_checkin_at <= now() + interval '7 days'
    AND (b.scheduled_checkout_at IS NULL OR b.scheduled_checkout_at >= now() - interval '2 days')
  ORDER BY b.scheduled_checkin_at DESC
  LIMIT 5;

  -- If no active match, fall back to: any booking in the last 90 days
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      h.id, h.slug, h.name, b.id, b.scheduled_checkin_at, 'RECENT_BOOKING'::text
    FROM public.bookings b
    JOIN public.hotels h ON h.id = b.hotel_id
    JOIN public.guests g ON g.id = b.guest_id
    WHERE g.mobile_normalized IN (v_nat10, '91' || v_nat10, v_in_digits)
      AND b.scheduled_checkin_at >= now() - interval '90 days'
    ORDER BY b.scheduled_checkin_at DESC
    LIMIT 5;
  END IF;

  -- If still no match, try leads (someone enquired but didn't book).
  -- leads.contact_phone_normalized is E.164 (written via _normalize_phone).
  IF NOT FOUND AND v_e164 IS NOT NULL THEN
    RETURN QUERY
    SELECT
      h.id, h.slug, h.name, NULL::uuid, l.created_at, 'LEAD_ONLY'::text
    FROM public.leads l
    JOIN public.hotels h ON h.id = l.hotel_id
    WHERE l.contact_phone_normalized = v_e164
      AND l.created_at >= now() - interval '90 days'
      AND l.deleted_at IS NULL
    ORDER BY l.last_activity_at DESC
    LIMIT 5;
  END IF;
END;
$function$;

-- Re-assert webhook-only exposure (defensive; ACL already set in 20260619000010)
REVOKE ALL ON FUNCTION public.wa_resolve_hotel_for_phone(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_resolve_hotel_for_phone(text) TO service_role;
