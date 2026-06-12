-- RLS lockdown — Phase 4: tables with RLS ENTIRELY DISABLED.
--
-- The phase-3 audit's complementary sweep (hotel-scoped tables where
-- relrowsecurity=false) found a second leak class the blanket-`true` sweep
-- could not see: tables with NO row-level security at all, so any authenticated
-- principal reads every hotel's rows. Confirmed on local with data:
--   • orders             — staff at Hotel A saw 83 rows from other hotels
--   • sla_risk_policies  — saw 15 other-hotel rows
-- Latent (RLS off, empty-for-others locally; would leak in prod): events,
-- hotel_staff, hotel_roles, leaves, staff_shifts.
--
-- This migration ENABLEs RLS and adds the standard hotel_members staff scope
-- (the user-approved invariant: no principal scoped to one hotel may read/write
-- another hotel's data). Preserved paths (verified against app code):
--   • orders is read by the ops layer (filtered by hotel) and written by the
--     `orders` edge function (service_role) — staff + guest-own + service kept.
--   • hotel_staff / staff_shifts are reached only via SECURITY DEFINER RPCs
--     (get_staff_shifts_dashboard, update_hotel_member, …) and service-role
--     edge functions, both of which bypass RLS — so enabling RLS is safe.
--   • hotel_roles / leaves are read by owner screens as authenticated members.
--
-- staff_shifts has no hotel_id; staff_shifts.staff_id FKs to hotel_members.id,
-- whose RLS is self-only — so (as in phase-3) the hotel is resolved through a
-- SECURITY DEFINER helper, not a direct join to another member's row.
--
-- NOTE (deliberately NOT done here — flagged for product): intra-hotel privacy.
-- `leaves` and `hotel_staff.cost_per_hour` are visible to ANY member of the
-- hotel under this scope. That seals the cross-tenant leak (the approved goal);
-- restricting leave/salary visibility to self + owner/manager is a finer RBAC
-- decision that needs product sign-off and the legacy-role-casing cleanup.
--
-- services_restore_test: a leftover test table (no code references) — dropped.

-- ════════════════════════════════════════════════════════════════════════
-- Helper: resolve a hotel_members.id to its hotel_id, bypassing the self-only
-- RLS on hotel_members. SECURITY DEFINER, same pattern as staff_shift_hotel_id.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.hotel_member_hotel_id(p_member_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT hotel_id FROM public.hotel_members WHERE id = p_member_id LIMIT 1;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- orders — staff (hotel) + guest-own (via booking) + service
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orders_staff_all"        ON public.orders;
DROP POLICY IF EXISTS "orders_guest_view_own"   ON public.orders;
DROP POLICY IF EXISTS "orders_service_role_all"  ON public.orders;
CREATE POLICY "orders_staff_all"
  ON public.orders FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = orders.hotel_id AND hm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = orders.hotel_id AND hm.user_id = auth.uid()));
CREATE POLICY "orders_guest_view_own"
  ON public.orders FOR SELECT TO anon, authenticated
  USING (orders.booking_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = orders.booking_id AND b.guest_id = public.current_guest_id()));
CREATE POLICY "orders_service_role_all"
  ON public.orders FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════════
-- sla_risk_policies — per-hotel config; staff + service
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.sla_risk_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sla_risk_policies_staff_all"        ON public.sla_risk_policies;
DROP POLICY IF EXISTS "sla_risk_policies_service_role_all" ON public.sla_risk_policies;
CREATE POLICY "sla_risk_policies_staff_all"
  ON public.sla_risk_policies FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = sla_risk_policies.hotel_id AND hm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = sla_risk_policies.hotel_id AND hm.user_id = auth.uid()));
CREATE POLICY "sla_risk_policies_service_role_all"
  ON public.sla_risk_policies FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════════
-- events — per-hotel; staff + service
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "events_staff_all"        ON public.events;
DROP POLICY IF EXISTS "events_service_role_all" ON public.events;
CREATE POLICY "events_staff_all"
  ON public.events FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = events.hotel_id AND hm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = events.hotel_id AND hm.user_id = auth.uid()));
CREATE POLICY "events_service_role_all"
  ON public.events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════════
-- grid_devices — per-hotel energy/device registry; staff + service
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.grid_devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "grid_devices_staff_all"        ON public.grid_devices;
DROP POLICY IF EXISTS "grid_devices_service_role_all" ON public.grid_devices;
CREATE POLICY "grid_devices_staff_all"
  ON public.grid_devices FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = grid_devices.hotel_id AND hm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = grid_devices.hotel_id AND hm.user_id = auth.uid()));
CREATE POLICY "grid_devices_service_role_all"
  ON public.grid_devices FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════════
-- HR cluster — hotel_staff, hotel_roles, leaves, staff_shifts
-- (the cluster the original lockdown explicitly deferred)
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.hotel_staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hotel_staff_member_all"        ON public.hotel_staff;
DROP POLICY IF EXISTS "hotel_staff_service_role_all"  ON public.hotel_staff;
CREATE POLICY "hotel_staff_member_all"
  ON public.hotel_staff FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = hotel_staff.hotel_id AND hm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = hotel_staff.hotel_id AND hm.user_id = auth.uid()));
CREATE POLICY "hotel_staff_service_role_all"
  ON public.hotel_staff FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.hotel_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hotel_roles_member_all"        ON public.hotel_roles;
DROP POLICY IF EXISTS "hotel_roles_service_role_all"  ON public.hotel_roles;
CREATE POLICY "hotel_roles_member_all"
  ON public.hotel_roles FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = hotel_roles.hotel_id AND hm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = hotel_roles.hotel_id AND hm.user_id = auth.uid()));
CREATE POLICY "hotel_roles_service_role_all"
  ON public.hotel_roles FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.leaves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leaves_member_all"        ON public.leaves;
DROP POLICY IF EXISTS "leaves_service_role_all"  ON public.leaves;
CREATE POLICY "leaves_member_all"
  ON public.leaves FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = leaves.hotel_id AND hm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = leaves.hotel_id AND hm.user_id = auth.uid()));
CREATE POLICY "leaves_service_role_all"
  ON public.leaves FOR ALL TO service_role USING (true) WITH CHECK (true);

-- staff_shifts — no hotel_id; resolve via helper (staff_id → hotel_members.hotel_id)
ALTER TABLE public.staff_shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_shifts_member_all"        ON public.staff_shifts;
DROP POLICY IF EXISTS "staff_shifts_service_role_all"  ON public.staff_shifts;
CREATE POLICY "staff_shifts_member_all"
  ON public.staff_shifts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = public.hotel_member_hotel_id(staff_shifts.staff_id)
                   AND hm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.hotel_members hm
                 WHERE hm.hotel_id = public.hotel_member_hotel_id(staff_shifts.staff_id)
                   AND hm.user_id = auth.uid()));
CREATE POLICY "staff_shifts_service_role_all"
  ON public.staff_shifts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════════
-- services_restore_test — leftover test table, no code references. Drop it.
-- ════════════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS public.services_restore_test;
