-- RLS lockdown — Phase 2: financial, operational, config, and menu tables.
--
-- These tables currently have RLS DISABLED, which means any authenticated
-- user can read every hotel's data. Per the project's multi-tenant rule
-- (CLAUDE.md: "every new table needs RLS scoped via hotel_members"), this
-- is a tenant-isolation hole.
--
-- For each table we:
--   1. ENABLE ROW LEVEL SECURITY
--   2. DROP+CREATE staff (hotel_members) policy — ALL within their hotel
--   3. DROP+CREATE service_role policy — ALL bypass
--   4. For PII / guest-visible tables, add a narrow guest SELECT policy
--   5. For guest-facing menu tables, allow anon SELECT for the storefront
--      while keeping mutations staff-only
--
-- All policies idempotent (DROP IF EXISTS → CREATE). Same pattern as
-- 20260602001005_folios and 20260602001006_silent_break.
--
-- Scope of this migration (23 tables):
--   Financial:   folio_entries, booking_charges, food_order_payments
--   Operational: booking_rooms, booking_room_guests, stay_guests,
--                ticket_events, ticket_sla_state, food_order_events,
--                food_order_assignments
--   Per-hotel:   departments, hotel_zones, owner_settings,
--                hotel_kpi_daily, pms_sync_state
--   Menu:        menu_items, menu_categories, menu_item_availability
--
-- Staff/HR tables (hotel_staff, hotel_roles, hotel_member_roles, leaves,
-- staff_shifts, etc.) are out of scope and addressed by a separate audit
-- specific to the OwnerStaffShifts feature.

-- ════════════════════════════════════════════════════════════════════════
-- FINANCIAL
-- ════════════════════════════════════════════════════════════════════════

-- ─── folio_entries ──────────────────────────────────────────────────────
-- Has hotel_id and booking_id. Same shape as folios; staff get ALL on their
-- hotel, guests get SELECT on entries on their own booking.
ALTER TABLE public.folio_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "folio_entries_staff_all"        ON public.folio_entries;
DROP POLICY IF EXISTS "folio_entries_guest_view_own"   ON public.folio_entries;
DROP POLICY IF EXISTS "folio_entries_service_role_all" ON public.folio_entries;

CREATE POLICY "folio_entries_staff_all"
  ON public.folio_entries
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = folio_entries.hotel_id
              AND hm.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = folio_entries.hotel_id
              AND hm.user_id = auth.uid())
  );

CREATE POLICY "folio_entries_guest_view_own"
  ON public.folio_entries
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.bookings b
            WHERE b.id = folio_entries.booking_id
              AND b.guest_id = public.current_guest_id())
  );

CREATE POLICY "folio_entries_service_role_all"
  ON public.folio_entries
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── booking_charges ────────────────────────────────────────────────────
-- No hotel_id; scope via bookings.hotel_id.
ALTER TABLE public.booking_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_charges_staff_all"        ON public.booking_charges;
DROP POLICY IF EXISTS "booking_charges_guest_view_own"   ON public.booking_charges;
DROP POLICY IF EXISTS "booking_charges_service_role_all" ON public.booking_charges;

CREATE POLICY "booking_charges_staff_all"
  ON public.booking_charges
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.hotel_members hm ON hm.hotel_id = b.hotel_id
      WHERE b.id = booking_charges.booking_id
        AND hm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.hotel_members hm ON hm.hotel_id = b.hotel_id
      WHERE b.id = booking_charges.booking_id
        AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "booking_charges_guest_view_own"
  ON public.booking_charges
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.bookings b
            WHERE b.id = booking_charges.booking_id
              AND b.guest_id = public.current_guest_id())
  );

CREATE POLICY "booking_charges_service_role_all"
  ON public.booking_charges
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── food_order_payments ────────────────────────────────────────────────
-- food_order_id → food_orders.hotel_id.
ALTER TABLE public.food_order_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "food_order_payments_staff_all"        ON public.food_order_payments;
DROP POLICY IF EXISTS "food_order_payments_service_role_all" ON public.food_order_payments;

CREATE POLICY "food_order_payments_staff_all"
  ON public.food_order_payments
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.food_orders fo
      JOIN public.hotel_members hm ON hm.hotel_id = fo.hotel_id
      WHERE fo.id = food_order_payments.food_order_id
        AND hm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.food_orders fo
      JOIN public.hotel_members hm ON hm.hotel_id = fo.hotel_id
      WHERE fo.id = food_order_payments.food_order_id
        AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "food_order_payments_service_role_all"
  ON public.food_order_payments
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════════
-- OPERATIONAL
-- ════════════════════════════════════════════════════════════════════════

-- ─── booking_rooms ──────────────────────────────────────────────────────
ALTER TABLE public.booking_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_rooms_staff_all"        ON public.booking_rooms;
DROP POLICY IF EXISTS "booking_rooms_guest_view_own"   ON public.booking_rooms;
DROP POLICY IF EXISTS "booking_rooms_service_role_all" ON public.booking_rooms;

CREATE POLICY "booking_rooms_staff_all"
  ON public.booking_rooms
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = booking_rooms.hotel_id
              AND hm.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = booking_rooms.hotel_id
              AND hm.user_id = auth.uid())
  );

CREATE POLICY "booking_rooms_guest_view_own"
  ON public.booking_rooms
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.bookings b
            WHERE b.id = booking_rooms.booking_id
              AND b.guest_id = public.current_guest_id())
  );

CREATE POLICY "booking_rooms_service_role_all"
  ON public.booking_rooms
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── booking_room_guests ────────────────────────────────────────────────
-- booking_room_id → booking_rooms.hotel_id.
ALTER TABLE public.booking_room_guests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_room_guests_staff_all"        ON public.booking_room_guests;
DROP POLICY IF EXISTS "booking_room_guests_guest_view_own"   ON public.booking_room_guests;
DROP POLICY IF EXISTS "booking_room_guests_service_role_all" ON public.booking_room_guests;

CREATE POLICY "booking_room_guests_staff_all"
  ON public.booking_room_guests
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.booking_rooms br
      JOIN public.hotel_members hm ON hm.hotel_id = br.hotel_id
      WHERE br.id = booking_room_guests.booking_room_id
        AND hm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.booking_rooms br
      JOIN public.hotel_members hm ON hm.hotel_id = br.hotel_id
      WHERE br.id = booking_room_guests.booking_room_id
        AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "booking_room_guests_guest_view_own"
  ON public.booking_room_guests
  FOR SELECT TO authenticated
  USING (
    booking_room_guests.guest_id IS NOT NULL
    AND booking_room_guests.guest_id = public.current_guest_id()
  );

CREATE POLICY "booking_room_guests_service_role_all"
  ON public.booking_room_guests
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── stay_guests ────────────────────────────────────────────────────────
-- stay_id → stays.hotel_id.
ALTER TABLE public.stay_guests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stay_guests_staff_all"        ON public.stay_guests;
DROP POLICY IF EXISTS "stay_guests_service_role_all" ON public.stay_guests;

CREATE POLICY "stay_guests_staff_all"
  ON public.stay_guests
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.stays s
      JOIN public.hotel_members hm ON hm.hotel_id = s.hotel_id
      WHERE s.id = stay_guests.stay_id
        AND hm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stays s
      JOIN public.hotel_members hm ON hm.hotel_id = s.hotel_id
      WHERE s.id = stay_guests.stay_id
        AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "stay_guests_service_role_all"
  ON public.stay_guests
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── ticket_events ──────────────────────────────────────────────────────
-- ticket_id → tickets.hotel_id.
ALTER TABLE public.ticket_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ticket_events_staff_all"        ON public.ticket_events;
DROP POLICY IF EXISTS "ticket_events_service_role_all" ON public.ticket_events;

CREATE POLICY "ticket_events_staff_all"
  ON public.ticket_events
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tickets t
      JOIN public.hotel_members hm ON hm.hotel_id = t.hotel_id
      WHERE t.id = ticket_events.ticket_id
        AND hm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tickets t
      JOIN public.hotel_members hm ON hm.hotel_id = t.hotel_id
      WHERE t.id = ticket_events.ticket_id
        AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "ticket_events_service_role_all"
  ON public.ticket_events
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── ticket_sla_state ───────────────────────────────────────────────────
ALTER TABLE public.ticket_sla_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ticket_sla_state_staff_all"        ON public.ticket_sla_state;
DROP POLICY IF EXISTS "ticket_sla_state_service_role_all" ON public.ticket_sla_state;

CREATE POLICY "ticket_sla_state_staff_all"
  ON public.ticket_sla_state
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tickets t
      JOIN public.hotel_members hm ON hm.hotel_id = t.hotel_id
      WHERE t.id = ticket_sla_state.ticket_id
        AND hm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tickets t
      JOIN public.hotel_members hm ON hm.hotel_id = t.hotel_id
      WHERE t.id = ticket_sla_state.ticket_id
        AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "ticket_sla_state_service_role_all"
  ON public.ticket_sla_state
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── food_order_events ──────────────────────────────────────────────────
ALTER TABLE public.food_order_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "food_order_events_staff_all"        ON public.food_order_events;
DROP POLICY IF EXISTS "food_order_events_service_role_all" ON public.food_order_events;

CREATE POLICY "food_order_events_staff_all"
  ON public.food_order_events
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.food_orders fo
      JOIN public.hotel_members hm ON hm.hotel_id = fo.hotel_id
      WHERE fo.id = food_order_events.food_order_id
        AND hm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.food_orders fo
      JOIN public.hotel_members hm ON hm.hotel_id = fo.hotel_id
      WHERE fo.id = food_order_events.food_order_id
        AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "food_order_events_service_role_all"
  ON public.food_order_events
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── food_order_assignments ─────────────────────────────────────────────
ALTER TABLE public.food_order_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "food_order_assignments_staff_all"        ON public.food_order_assignments;
DROP POLICY IF EXISTS "food_order_assignments_service_role_all" ON public.food_order_assignments;

CREATE POLICY "food_order_assignments_staff_all"
  ON public.food_order_assignments
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.food_orders fo
      JOIN public.hotel_members hm ON hm.hotel_id = fo.hotel_id
      WHERE fo.id = food_order_assignments.food_order_id
        AND hm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.food_orders fo
      JOIN public.hotel_members hm ON hm.hotel_id = fo.hotel_id
      WHERE fo.id = food_order_assignments.food_order_id
        AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "food_order_assignments_service_role_all"
  ON public.food_order_assignments
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════════
-- PER-HOTEL CONFIG
-- ════════════════════════════════════════════════════════════════════════

-- Helper macro pattern repeated below for each per-hotel table with
-- hotel_id. Same shape: staff ALL within their hotel + service_role ALL.

-- ─── departments ────────────────────────────────────────────────────────
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "departments_staff_all"        ON public.departments;
DROP POLICY IF EXISTS "departments_service_role_all" ON public.departments;

CREATE POLICY "departments_staff_all"
  ON public.departments
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = departments.hotel_id
              AND hm.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = departments.hotel_id
              AND hm.user_id = auth.uid())
  );

CREATE POLICY "departments_service_role_all"
  ON public.departments
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── hotel_zones ────────────────────────────────────────────────────────
ALTER TABLE public.hotel_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hotel_zones_staff_all"        ON public.hotel_zones;
DROP POLICY IF EXISTS "hotel_zones_service_role_all" ON public.hotel_zones;

CREATE POLICY "hotel_zones_staff_all"
  ON public.hotel_zones
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = hotel_zones.hotel_id
              AND hm.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = hotel_zones.hotel_id
              AND hm.user_id = auth.uid())
  );

CREATE POLICY "hotel_zones_service_role_all"
  ON public.hotel_zones
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── owner_settings ─────────────────────────────────────────────────────
ALTER TABLE public.owner_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_settings_staff_all"        ON public.owner_settings;
DROP POLICY IF EXISTS "owner_settings_service_role_all" ON public.owner_settings;

CREATE POLICY "owner_settings_staff_all"
  ON public.owner_settings
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = owner_settings.hotel_id
              AND hm.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = owner_settings.hotel_id
              AND hm.user_id = auth.uid())
  );

CREATE POLICY "owner_settings_service_role_all"
  ON public.owner_settings
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── hotel_kpi_daily ────────────────────────────────────────────────────
ALTER TABLE public.hotel_kpi_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hotel_kpi_daily_staff_all"        ON public.hotel_kpi_daily;
DROP POLICY IF EXISTS "hotel_kpi_daily_service_role_all" ON public.hotel_kpi_daily;

CREATE POLICY "hotel_kpi_daily_staff_all"
  ON public.hotel_kpi_daily
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = hotel_kpi_daily.hotel_id
              AND hm.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = hotel_kpi_daily.hotel_id
              AND hm.user_id = auth.uid())
  );

CREATE POLICY "hotel_kpi_daily_service_role_all"
  ON public.hotel_kpi_daily
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── pms_sync_state ─────────────────────────────────────────────────────
ALTER TABLE public.pms_sync_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pms_sync_state_staff_all"        ON public.pms_sync_state;
DROP POLICY IF EXISTS "pms_sync_state_service_role_all" ON public.pms_sync_state;

CREATE POLICY "pms_sync_state_staff_all"
  ON public.pms_sync_state
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = pms_sync_state.hotel_id
              AND hm.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = pms_sync_state.hotel_id
              AND hm.user_id = auth.uid())
  );

CREATE POLICY "pms_sync_state_service_role_all"
  ON public.pms_sync_state
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════════
-- MENU (guest-facing storefront)
-- ════════════════════════════════════════════════════════════════════════
-- Menu items / categories must be readable by anon — guests browse the
-- menu without authenticating. Mutations are staff-only.

-- ─── menu_items ─────────────────────────────────────────────────────────
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "menu_items_anon_select"       ON public.menu_items;
DROP POLICY IF EXISTS "menu_items_staff_write"       ON public.menu_items;
DROP POLICY IF EXISTS "menu_items_service_role_all"  ON public.menu_items;

CREATE POLICY "menu_items_anon_select"
  ON public.menu_items
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "menu_items_staff_write"
  ON public.menu_items
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = menu_items.hotel_id
              AND hm.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = menu_items.hotel_id
              AND hm.user_id = auth.uid())
  );

CREATE POLICY "menu_items_service_role_all"
  ON public.menu_items
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── menu_categories ────────────────────────────────────────────────────
ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "menu_categories_anon_select"       ON public.menu_categories;
DROP POLICY IF EXISTS "menu_categories_staff_write"       ON public.menu_categories;
DROP POLICY IF EXISTS "menu_categories_service_role_all"  ON public.menu_categories;

CREATE POLICY "menu_categories_anon_select"
  ON public.menu_categories
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "menu_categories_staff_write"
  ON public.menu_categories
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = menu_categories.hotel_id
              AND hm.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.hotel_members hm
            WHERE hm.hotel_id = menu_categories.hotel_id
              AND hm.user_id = auth.uid())
  );

CREATE POLICY "menu_categories_service_role_all"
  ON public.menu_categories
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── menu_item_availability ─────────────────────────────────────────────
-- Per-day availability for a menu_item. Scope via menu_items.hotel_id.
ALTER TABLE public.menu_item_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "menu_item_availability_anon_select"       ON public.menu_item_availability;
DROP POLICY IF EXISTS "menu_item_availability_staff_write"       ON public.menu_item_availability;
DROP POLICY IF EXISTS "menu_item_availability_service_role_all"  ON public.menu_item_availability;

CREATE POLICY "menu_item_availability_anon_select"
  ON public.menu_item_availability
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "menu_item_availability_staff_write"
  ON public.menu_item_availability
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.menu_items mi
      JOIN public.hotel_members hm ON hm.hotel_id = mi.hotel_id
      WHERE mi.id = menu_item_availability.menu_item_id
        AND hm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.menu_items mi
      JOIN public.hotel_members hm ON hm.hotel_id = mi.hotel_id
      WHERE mi.id = menu_item_availability.menu_item_id
        AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "menu_item_availability_service_role_all"
  ON public.menu_item_availability
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
