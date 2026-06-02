-- RLS hot-fix — guest storefront access
--
-- The phase 2 lockdown (20260602001007) restricted hotel_zones, departments,
-- food_order_events, food_order_assignments, and food_order_payments to
-- staff (hotel_members) + service_role only. That broke three guest-facing
-- flows discovered during post-deploy audit:
--
--   1. FoodMenu (/menu, /stay/:code/menu) — reads hotel_zones to render
--      the zone picker for delivery selection. Guests are NOT hotel_members
--      so the previous lockdown returned 0 zones.
--   2. FoodOrderTracker (guest-facing order timeline) — reads departments
--      to fetch KITCHEN dept SLA for pre-acceptance fallback, AND reads
--      food_order_events for the timeline. Both blocked under staff-only.
--   3. GuestNewHome — reads menu_categories (already had anon SELECT so
--      this one was fine; flagging only for completeness).
--
-- Fixes (all idempotent DROP+CREATE):
--
--   hotel_zones / departments — these are per-hotel CONFIG, not PII.
--     Adding anon, authenticated SELECT for active rows. Mutations still
--     gated by staff. Same model as menu_items.
--
--   food_order_events / food_order_assignments / food_order_payments —
--     guests can view events on their OWN orders. Scoped through
--     food_orders → stays.guest_id = current_guest_id(), matching the
--     existing "Guests can view own orders" policy on food_orders.

-- ─── hotel_zones — public read of active zones ──────────────────────────
DROP POLICY IF EXISTS "hotel_zones_anon_select" ON public.hotel_zones;
CREATE POLICY "hotel_zones_anon_select"
  ON public.hotel_zones
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

-- ─── departments — public read of active departments ────────────────────
DROP POLICY IF EXISTS "departments_anon_select" ON public.departments;
CREATE POLICY "departments_anon_select"
  ON public.departments
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

-- ─── food_order_events — guest sees events on their own orders ──────────
DROP POLICY IF EXISTS "food_order_events_guest_view_own" ON public.food_order_events;
CREATE POLICY "food_order_events_guest_view_own"
  ON public.food_order_events
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.food_orders fo
      LEFT JOIN public.stays s ON s.id = fo.stay_id
      WHERE fo.id = food_order_events.food_order_id
        AND (
          -- Guest is the primary stayer
          s.guest_id = public.current_guest_id()
          -- Or one of the additional guests on this stay
          OR EXISTS (
            SELECT 1 FROM public.stay_guests sg
            WHERE sg.stay_id = s.id
              AND sg.guest_id = public.current_guest_id()
          )
        )
    )
  );

-- ─── food_order_assignments — guest sees assignments on their own orders
DROP POLICY IF EXISTS "food_order_assignments_guest_view_own" ON public.food_order_assignments;
CREATE POLICY "food_order_assignments_guest_view_own"
  ON public.food_order_assignments
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.food_orders fo
      LEFT JOIN public.stays s ON s.id = fo.stay_id
      WHERE fo.id = food_order_assignments.food_order_id
        AND (
          s.guest_id = public.current_guest_id()
          OR EXISTS (
            SELECT 1 FROM public.stay_guests sg
            WHERE sg.stay_id = s.id
              AND sg.guest_id = public.current_guest_id()
          )
        )
    )
  );

-- ─── food_order_payments — guest sees payments on their own orders ──────
DROP POLICY IF EXISTS "food_order_payments_guest_view_own" ON public.food_order_payments;
CREATE POLICY "food_order_payments_guest_view_own"
  ON public.food_order_payments
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.food_orders fo
      LEFT JOIN public.stays s ON s.id = fo.stay_id
      WHERE fo.id = food_order_payments.food_order_id
        AND (
          s.guest_id = public.current_guest_id()
          OR EXISTS (
            SELECT 1 FROM public.stay_guests sg
            WHERE sg.stay_id = s.id
              AND sg.guest_id = public.current_guest_id()
          )
        )
    )
  );

-- ─── ticket_events — guest sees comments on their own tickets ───────────
-- `getTicketComments` in api.ts:2014 directly SELECTs ticket_events for the
-- guest-facing ticket timeline. The phase-1 silent-break fix (20260602001006)
-- only gave staff access. INSERTs from guests go via the SECURITY DEFINER
-- `add_guest_comment` RPC (bypasses RLS), so this is SELECT-only. Scope
-- mirrors the existing tickets.guest_can_view_own_tickets_only policy:
-- stays.guest_id matches OR stay_guests.guest_id matches.
DROP POLICY IF EXISTS "ticket_events_guest_view_own" ON public.ticket_events;
CREATE POLICY "ticket_events_guest_view_own"
  ON public.ticket_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tickets t
      JOIN public.stays s ON s.id = t.stay_id
      WHERE t.id = ticket_events.ticket_id
        AND (
          s.guest_id = public.current_guest_id()
          OR EXISTS (
            SELECT 1 FROM public.stay_guests sg
            WHERE sg.stay_id = s.id
              AND sg.guest_id = public.current_guest_id()
          )
        )
    )
  );
