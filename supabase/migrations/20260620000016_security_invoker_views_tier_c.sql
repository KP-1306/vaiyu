-- ============================================================
-- VAiyu: SECURITY DEFINER view sweep — Tier C (authenticated-readable)
-- ============================================================
-- The 82 views readable by `authenticated` (NOT anon) that still ran as
-- SECURITY DEFINER (bypassing RLS). Not an open-internet leak (anon can't read
-- them), but a cross-tenant risk among logged-in users — any signed-up user could
-- read other hotels' data through them. Fix: security_invoker=true so the
-- querying user's member RLS applies (verified: a 3-hotel member sees only their
-- hotels' rows; the frontend already filters owner/ops dashboards by hotel_id, so
-- results are unchanged for legit callers).
--
-- Correctness sweep (member-vs-expected, 78 hotel_id views) found exactly one
-- break class: the grid_* energy views ERRORed for a member —
-- "permission denied for table grid_readings" — because grid_readings was sealed
-- service_role-only (20260620000005) yet the views (api.ts: grid_device_energy_daily
-- / grid_zone_energy_daily / grid_silent_killers_top5) are member-facing. The
-- correct fix is to let owners read THEIR OWN hotel's energy data via RLS (not via
-- a definer bypass): grant authenticated SELECT + a member-scoped policy on
-- grid_readings (scoped through grid_devices.hotel_id, mirroring grid_devices_staff_all).
-- Writes stay service_role-only (IoT ingestion). Then the grid views scope correctly
-- under invoker.
--
-- Left as definer BY DESIGN (not flipped):
--   • v_public_hotels (anon bridge) + anon self-filtering observability/guest views
--     (user_bills_overview, v_guest_food_orders, v_guest_tickets, v_food_orders_sla_risk,
--     hotels_for_user, v_api_24h, v_api_top_fns_24h) — from Tier A.
--   • the 11 authenticated views that SELF-FILTER by current_guest_id()/auth.uid()
--     (v_guest_active_bookings, v_guest_home_dashboard[_base], v_guest_stay_display,
--     v_guest_stay_hero[_base], user_recent_stays, user_stay_detail, user_stays_overview,
--     rewards_overview, reward_vouchers_with_hotels). A view with WHERE
--     guest_id = current_guest_id() only ever returns the CALLER's data, so it is NOT a
--     cross-tenant leak even as definer; and these inner-join hotels/rooms/room_types, so
--     invoker would require guest RLS on every joined table (the guest portal can't be
--     fully fixture-tested locally) — needless risk for zero security gain. They stay
--     definer (documented self-filtering exception). No owner/ops view references auth.uid
--     (they scope via the frontend hotel_id filter + member RLS), so this exclusion is
--     precise.
-- ============================================================

-- ── 1. grid_readings: member-scoped read so the energy views work under invoker ──
GRANT SELECT ON public.grid_readings TO authenticated;
DROP POLICY IF EXISTS "grid_readings_member_read" ON public.grid_readings;
CREATE POLICY "grid_readings_member_read"
  ON public.grid_readings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.grid_devices d
      WHERE d.id = grid_readings.device_id
        AND public.vaiyu_is_hotel_member(d.hotel_id)
    )
  );

-- ── 2. Flip every authenticated-only SECURITY DEFINER view to invoker ──────────
DO $$
DECLARE v text;
BEGIN
  FOR v IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
      AND has_table_privilege('authenticated', c.oid, 'SELECT')
      AND NOT has_table_privilege('anon', c.oid, 'SELECT')   -- anon self-filtering/public views stay definer by design
      AND pg_get_viewdef(c.oid, true) !~* '(current_guest_id|auth\.uid)'  -- self-filtering views stay definer (not leaks; flipping risks guest portal)
      AND NOT COALESCE(
            (SELECT option_value::bool FROM pg_options_to_table(c.reloptions) WHERE option_name='security_invoker'),
            false)
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true);', v);
  END LOOP;
END $$;
